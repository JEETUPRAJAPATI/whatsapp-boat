import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConnectionStatus, Prisma } from '@prisma/client';
import { MetaConfig } from '../../config/configuration';
import { MetaSettingsService } from '../../config/meta-settings.service';
import { MetaBusinessService, MetaPhoneNumber, MetaWaba } from '../../meta/meta-business.service';
import { MetaCatalogService } from '../../meta/meta-catalog.service';
import { MetaTokenService } from '../../meta/meta-token.service';
import { PrismaService } from '../../prisma/prisma.service';

const ACCOUNT_INCLUDE = {
  business: true,
  phoneNumbers: { orderBy: { createdAt: 'asc' } },
  catalogs: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.WhatsappAccountInclude;

/**
 * Owns the Business -> WABA -> PhoneNumber -> Catalog tree.
 *
 * Every read of Meta state lands in the database, so the admin panel can be
 * fast and still be honest: the UI shows what we last saw, with an explicit
 * "refresh" that goes back to Meta.
 */
@Injectable()
export class AccountService implements OnModuleInit {
  private readonly logger = new Logger(AccountService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: MetaTokenService,
    private readonly business: MetaBusinessService,
    private readonly catalogApi: MetaCatalogService,
    private readonly config: ConfigService,
    private readonly metaSettings: MetaSettingsService,
  ) {}

  private get meta(): MetaConfig {
    return this.metaSettings.getSettings();
  }

  // -----------------------------------------------------------------------
  // Bootstrap
  // -----------------------------------------------------------------------

  /**
   * Adopts an already-working number described in .env.
   *
   * Most operators arrive here with a live WhatsApp number and a System User
   * token, not a blank slate - so if META_WABA_ID and META_ACCESS_TOKEN are
   * present and we have no account yet, we import that account on first boot
   * rather than making them click through onboarding for a number that is
   * already onboarded.
   */
  async onModuleInit() {
    // wabaId is a one-time bootstrap convenience (import the account already
    // described in .env on first boot) and was never moved into the DB-backed
    // settings table - it still comes straight from the environment.
    const wabaId = this.config.get<MetaConfig>('meta').wabaId;
    const { accessToken } = this.meta;
    if (!wabaId || !accessToken) return;

    try {
      const existing = await this.prisma.whatsappAccount.findUnique({ where: { wabaId } });
      if (existing) return;

      this.logger.log(`Importing WhatsApp Business Account ${wabaId} from environment configuration`);
      await this.importFromMeta({ token: accessToken, wabaId, makeDefault: true });
      this.logger.log('Environment WhatsApp account imported');
    } catch (err) {
      // A bad token or an offline database must not stop the server from
      // booting - the webhook still has to be able to answer Meta.
      this.logger.warn(`Could not import the environment WhatsApp account: ${(err as Error).message}`);
    }
  }

  // -----------------------------------------------------------------------
  // Import / connect
  // -----------------------------------------------------------------------

  /**
   * Pulls a WABA, its numbers and its catalogs from Meta and stores them.
   * Used by both env bootstrap and Embedded Signup, so there is one code path
   * that decides what "connected" means.
   */
  async importFromMeta(params: {
    token: string;
    wabaId: string;
    /** Present for Embedded Signup; env bootstrap discovers it from the WABA. */
    businessId?: string;
    makeDefault?: boolean;
    /** Store the token against this account (Embedded Signup only). */
    persistToken?: { expiresInSeconds?: number | null; scopes?: string[]; tokenType?: string };
  }) {
    const waba = await this.business.getWaba(params.token, params.wabaId);
    const businessRecord = await this.upsertBusiness(waba, params.businessId);

    const account = await this.prisma.whatsappAccount.upsert({
      where: { wabaId: waba.id },
      create: {
        businessId: businessRecord.id,
        wabaId: waba.id,
        name: waba.name || `WABA ${waba.id}`,
        currency: waba.currency || null,
        timezoneId: waba.timezone_id ? String(waba.timezone_id) : null,
        status: ConnectionStatus.CONNECTED,
        isDefault: Boolean(params.makeDefault),
        lastCheckedAt: new Date(),
      },
      update: {
        businessId: businessRecord.id,
        name: waba.name || `WABA ${waba.id}`,
        currency: waba.currency || null,
        timezoneId: waba.timezone_id ? String(waba.timezone_id) : null,
        status: ConnectionStatus.CONNECTED,
        statusMessage: null,
        lastCheckedAt: new Date(),
      },
    });

    if (params.persistToken) {
      await this.tokens.store({
        whatsappAccountId: account.id,
        accessToken: params.token,
        tokenType: params.persistToken.tokenType,
        expiresInSeconds: params.persistToken.expiresInSeconds,
        scopes: params.persistToken.scopes,
      });
    }

    await this.syncPhoneNumbers(account.id, params.token, waba.id);
    await this.syncCatalogs(account.id, params.token, waba.id, waba.currency || 'INR');
    await this.ensureWebhookSubscription(account.id, params.token, waba.id);
    await this.ensureSingleDefault(account.id, Boolean(params.makeDefault));

    return this.findAccount(account.id);
  }

  private async upsertBusiness(waba: MetaWaba, explicitBusinessId?: string) {
    const metaBusinessId = explicitBusinessId || waba.owner_business_info?.id || this.meta.businessId || null;
    const name = waba.owner_business_info?.name || this.meta.businessName || waba.name || 'My Business';

    if (metaBusinessId) {
      return this.prisma.business.upsert({
        where: { metaBusinessId },
        create: { metaBusinessId, name, currency: waba.currency || 'INR' },
        update: { name },
      });
    }

    // No business id visible from this token - keep a single local business
    // rather than creating a new orphan row on every import.
    const existing = await this.prisma.business.findFirst({ orderBy: { createdAt: 'asc' } });
    if (existing) return existing;
    return this.prisma.business.create({ data: { name, currency: waba.currency || 'INR' } });
  }

  /** Exactly one account may carry isDefault. */
  private async ensureSingleDefault(accountId: string, requested: boolean) {
    const count = await this.prisma.whatsappAccount.count();
    const shouldBeDefault = requested || count === 1;
    if (!shouldBeDefault) return;

    await this.prisma.$transaction([
      this.prisma.whatsappAccount.updateMany({
        where: { id: { not: accountId } },
        data: { isDefault: false },
      }),
      this.prisma.whatsappAccount.update({
        where: { id: accountId },
        data: { isDefault: true },
      }),
    ]);
  }

  // -----------------------------------------------------------------------
  // Sync helpers
  // -----------------------------------------------------------------------

  async syncPhoneNumbers(accountId: string, token: string, wabaId: string) {
    const numbers = await this.business.listPhoneNumbers(token, wabaId);

    for (const [index, number] of numbers.entries()) {
      const commerce = await this.business.getCommerceSettings(token, number.id);
      const data = {
        phoneNumber: number.display_phone_number,
        displayName: number.verified_name || null,
        verificationStatus: number.code_verification_status || null,
        qualityRating: number.quality_rating || null,
        messagingStatus: number.status || null,
        platformType: number.platform_type || null,
        throughputLevel: number.throughput?.level || null,
        catalogVisible: commerce?.is_catalog_visible ?? null,
        cartEnabled: commerce?.is_cart_enabled ?? null,
        status: AccountService.phoneStatus(number),
      };

      await this.prisma.whatsappPhoneNumber.upsert({
        where: { phoneNumberId: number.id },
        create: {
          whatsappAccountId: accountId,
          phoneNumberId: number.id,
          isDefault: index === 0,
          ...data,
        },
        update: { whatsappAccountId: accountId, ...data },
      });
    }

    // A number removed at Meta should stop looking connected here.
    const liveIds = numbers.map((n) => n.id);
    await this.prisma.whatsappPhoneNumber.updateMany({
      where: { whatsappAccountId: accountId, phoneNumberId: { notIn: liveIds.length ? liveIds : ['-'] } },
      data: { status: ConnectionStatus.DISCONNECTED },
    });

    return numbers.length;
  }

  private static phoneStatus(number: MetaPhoneNumber): ConnectionStatus {
    const status = String(number.status || '').toUpperCase();
    if (status === 'CONNECTED') return ConnectionStatus.CONNECTED;
    if (status === 'FLAGGED' || status === 'RESTRICTED' || status === 'BANNED') {
      return ConnectionStatus.ERROR;
    }
    if (String(number.code_verification_status || '').toUpperCase() === 'VERIFIED') {
      return ConnectionStatus.CONNECTED;
    }
    return ConnectionStatus.PENDING;
  }

  async syncCatalogs(accountId: string, token: string, wabaId: string, currency: string) {
    let catalogs = await this.catalogApi.listCatalogsForWaba(token, wabaId).catch((err) => {
      this.logger.warn(`Could not list catalogs for WABA ${wabaId}: ${(err as Error).message}`);
      return [];
    });

    // Fall back to an explicitly configured catalog when the WABA edge is empty
    // (a catalog can be owned by the business but not yet linked to WhatsApp).
    if (!catalogs.length && this.meta.catalogId) {
      const configured = await this.catalogApi
        .getCatalog(token, this.meta.catalogId)
        .catch(() => null);
      if (configured) catalogs = [configured];
    }

    for (const [index, catalog] of catalogs.entries()) {
      await this.prisma.catalog.upsert({
        where: { metaCatalogId: catalog.id },
        create: {
          whatsappAccountId: accountId,
          metaCatalogId: catalog.id,
          name: catalog.name || `Catalog ${catalog.id}`,
          vertical: catalog.vertical || null,
          currency: currency || 'INR',
          status: ConnectionStatus.CONNECTED,
          isDefault: index === 0,
        },
        update: {
          whatsappAccountId: accountId,
          name: catalog.name || `Catalog ${catalog.id}`,
          vertical: catalog.vertical || null,
          status: ConnectionStatus.CONNECTED,
        },
      });
    }

    return catalogs.length;
  }

  async ensureWebhookSubscription(accountId: string, token: string, wabaId: string) {
    try {
      const already = await this.business.isSubscribed(token, wabaId);
      if (!already) await this.business.subscribeApp(token, wabaId);

      await this.prisma.whatsappAccount.update({
        where: { id: accountId },
        data: { webhookSubscribed: true },
      });
      return true;
    } catch (err) {
      // Subscribing needs whatsapp_business_management; a token without it can
      // still manage a catalog, so this is a warning, not a failed connect.
      this.logger.warn(`Webhook subscription failed for ${wabaId}: ${(err as Error).message}`);
      await this.prisma.whatsappAccount.update({
        where: { id: accountId },
        data: { webhookSubscribed: false },
      });
      return false;
    }
  }

  // -----------------------------------------------------------------------
  // Queries
  // -----------------------------------------------------------------------

  async listAccounts() {
    const accounts = await this.prisma.whatsappAccount.findMany({
      include: ACCOUNT_INCLUDE,
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    return accounts.map((account) => this.serialize(account));
  }

  async findAccount(id: string) {
    const account = await this.prisma.whatsappAccount.findUnique({
      where: { id },
      include: ACCOUNT_INCLUDE,
    });
    if (!account) throw new NotFoundException('WhatsApp account not found');
    return this.serialize(account);
  }

  async requireAccountRecord(id: string) {
    const account = await this.prisma.whatsappAccount.findUnique({
      where: { id },
      include: ACCOUNT_INCLUDE,
    });
    if (!account) throw new NotFoundException('WhatsApp account not found');
    return account;
  }

  /** The account used when the caller does not name one. */
  async defaultAccount() {
    const account = await this.prisma.whatsappAccount.findFirst({
      where: { isDefault: true },
      include: ACCOUNT_INCLUDE,
    });
    if (account) return account;
    return this.prisma.whatsappAccount.findFirst({
      include: ACCOUNT_INCLUDE,
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Resolves which number sends a message: the caller's choice, else the
   * account default, else the first connected number.
   */
  async resolveSendingNumber(params: { accountId?: string; phoneNumberId?: string }) {
    if (params.phoneNumberId) {
      const number = await this.prisma.whatsappPhoneNumber.findUnique({
        where: { phoneNumberId: params.phoneNumberId },
        include: { account: true },
      });
      if (!number) throw new NotFoundException('That WhatsApp phone number is not connected here.');
      return number;
    }

    const account = params.accountId
      ? await this.requireAccountRecord(params.accountId)
      : await this.defaultAccount();

    if (!account) {
      throw new BadRequestException(
        'No WhatsApp Business Account is connected yet. Connect one from WhatsApp > Connection.',
      );
    }

    const numbers = await this.prisma.whatsappPhoneNumber.findMany({
      where: { whatsappAccountId: account.id },
      include: { account: true },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });

    const usable = numbers.find((n) => n.status === ConnectionStatus.CONNECTED) || numbers[0];
    if (!usable) {
      throw new BadRequestException(
        'This WhatsApp Business Account has no phone number registered yet.',
      );
    }
    return usable;
  }

  // -----------------------------------------------------------------------
  // Live status
  // -----------------------------------------------------------------------

  /**
   * Re-reads everything from Meta. This is what the "Refresh" button calls and
   * what turns a stale CONNECTED badge into an honest ERROR one.
   */
  async refresh(accountId: string) {
    const account = await this.requireAccountRecord(accountId);

    try {
      const token = await this.tokens.forAccount(account.id);
      const waba = await this.business.getWaba(token, account.wabaId);

      await this.prisma.whatsappAccount.update({
        where: { id: account.id },
        data: {
          name: waba.name || account.name,
          currency: waba.currency || account.currency,
          status: ConnectionStatus.CONNECTED,
          statusMessage: null,
          lastCheckedAt: new Date(),
        },
      });

      await this.syncPhoneNumbers(account.id, token, account.wabaId);
      await this.syncCatalogs(account.id, token, account.wabaId, waba.currency || account.currency || 'INR');
      await this.ensureWebhookSubscription(account.id, token, account.wabaId);

      return this.findAccount(account.id);
    } catch (err) {
      const message = (err as any)?.response?.message || (err as Error).message;
      await this.prisma.whatsappAccount.update({
        where: { id: account.id },
        data: {
          status: ConnectionStatus.ERROR,
          statusMessage: String(message).slice(0, 400),
          lastCheckedAt: new Date(),
        },
      });
      throw err;
    }
  }

  /** Dashboard/banner summary. Contains no secrets. */
  async connectionStatus() {
    const [accounts, credentialCount] = await Promise.all([
      this.prisma.whatsappAccount.findMany({ include: ACCOUNT_INCLUDE }),
      this.prisma.metaCredential.count(),
    ]);

    const phoneNumbers = accounts.flatMap((a) => a.phoneNumbers);
    const catalogs = accounts.flatMap((a) => a.catalogs);

    return {
      configured: accounts.length > 0,
      /** True when a token exists anywhere - stored or from .env. */
      hasToken: credentialCount > 0 || this.tokens.hasFallbackToken,
      accounts: accounts.length,
      connectedAccounts: accounts.filter((a) => a.status === ConnectionStatus.CONNECTED).length,
      phoneNumbers: phoneNumbers.length,
      connectedNumbers: phoneNumbers.filter((n) => n.status === ConnectionStatus.CONNECTED).length,
      catalogs: catalogs.length,
      webhookSubscribed: accounts.some((a) => a.webhookSubscribed),
      apiVersion: this.meta.apiVersion,
      hasAppSecret: Boolean(this.meta.appSecret),
      embeddedSignupAvailable: Boolean(this.meta.appId && this.meta.configId),
      webhookUrl: `${this.config.get<string>('publicUrl')}/api/whatsapp/webhook`,
    };
  }

  // -----------------------------------------------------------------------
  // Discovery (used by the setup wizard)
  // -----------------------------------------------------------------------

  async discoverBusinesses() {
    const token = this.tokens.requireBootstrapToken();
    return this.business.listBusinesses(token);
  }

  async discoverWabas(businessId?: string) {
    const token = this.tokens.requireBootstrapToken();
    if (businessId) return this.business.listWabasForBusiness(token, businessId);
    // No business chosen: fall back to whatever the token itself can see.
    return this.business.listWabasForToken(token);
  }

  async discoverPhoneNumbers(wabaId: string) {
    const token = this.tokens.requireBootstrapToken();
    return this.business.listPhoneNumbers(token, wabaId);
  }

  /**
   * Manual connect for an operator with a System User token, i.e. the number
   * is already live and Embedded Signup is unnecessary.
   */
  async connectManually(params: { wabaId: string; businessId?: string; makeDefault?: boolean }) {
    const token = this.tokens.requireBootstrapToken();
    return this.importFromMeta({
      token,
      wabaId: params.wabaId,
      businessId: params.businessId,
      makeDefault: params.makeDefault,
    });
  }

  async disconnect(accountId: string) {
    const account = await this.requireAccountRecord(accountId);

    // Best-effort: stop Meta delivering webhooks for an account we no longer manage.
    try {
      const token = await this.tokens.forAccount(account.id);
      await this.business.unsubscribeApp(token, account.wabaId);
    } catch (err) {
      this.logger.warn(`Could not unsubscribe webhooks for ${account.wabaId}: ${(err as Error).message}`);
    }

    await this.tokens.remove(account.id);
    await this.prisma.whatsappAccount.update({
      where: { id: account.id },
      data: {
        status: ConnectionStatus.DISCONNECTED,
        webhookSubscribed: false,
        isDefault: false,
        statusMessage: 'Disconnected from the admin panel',
      },
    });

    return { success: true };
  }

  // -----------------------------------------------------------------------
  // Phone number onboarding passthrough
  // -----------------------------------------------------------------------

  async requestVerificationCode(accountId: string, phoneNumberId: string, method: 'SMS' | 'VOICE') {
    const token = await this.tokens.forAccount(accountId);
    return this.business.requestVerificationCode(token, phoneNumberId, method);
  }

  async verifyCode(accountId: string, phoneNumberId: string, code: string) {
    const token = await this.tokens.forAccount(accountId);
    const result = await this.business.verifyCode(token, phoneNumberId, code);
    await this.refreshPhoneNumber(accountId, phoneNumberId);
    return result;
  }

  async registerPhoneNumber(accountId: string, phoneNumberId: string, pin: string) {
    const token = await this.tokens.forAccount(accountId);
    const result = await this.business.register(token, phoneNumberId, pin);
    await this.refreshPhoneNumber(accountId, phoneNumberId);
    return result;
  }

  private async refreshPhoneNumber(accountId: string, phoneNumberId: string) {
    try {
      const token = await this.tokens.forAccount(accountId);
      const number = await this.business.getPhoneNumber(token, phoneNumberId);
      await this.prisma.whatsappPhoneNumber.update({
        where: { phoneNumberId },
        data: {
          verificationStatus: number.code_verification_status || null,
          qualityRating: number.quality_rating || null,
          messagingStatus: number.status || null,
          displayName: number.verified_name || null,
          status: AccountService.phoneStatus(number),
        },
      });
    } catch (err) {
      this.logger.warn(`Could not refresh phone number ${phoneNumberId}: ${(err as Error).message}`);
    }
  }

  async setCommerceSettings(
    accountId: string,
    phoneNumberId: string,
    settings: { isCatalogVisible?: boolean; isCartEnabled?: boolean },
  ) {
    const token = await this.tokens.forAccount(accountId);
    const result = await this.business.updateCommerceSettings(token, phoneNumberId, settings);

    await this.prisma.whatsappPhoneNumber.update({
      where: { phoneNumberId },
      data: {
        catalogVisible: settings.isCatalogVisible ?? undefined,
        cartEnabled: settings.isCartEnabled ?? undefined,
      },
    });
    return result;
  }

  // -----------------------------------------------------------------------
  // Serialisation - the only shape the browser ever sees
  // -----------------------------------------------------------------------

  private serialize(account: Prisma.WhatsappAccountGetPayload<{ include: typeof ACCOUNT_INCLUDE }>) {
    return {
      id: account.id,
      wabaId: account.wabaId,
      name: account.name,
      currency: account.currency,
      status: account.status,
      statusMessage: account.statusMessage,
      webhookSubscribed: account.webhookSubscribed,
      isDefault: account.isDefault,
      lastCheckedAt: account.lastCheckedAt,
      business: account.business
        ? {
            id: account.business.id,
            name: account.business.name,
            metaBusinessId: account.business.metaBusinessId,
            currency: account.business.currency,
          }
        : null,
      phoneNumbers: account.phoneNumbers.map((number) => ({
        id: number.id,
        phoneNumberId: number.phoneNumberId,
        phoneNumber: number.phoneNumber,
        displayName: number.displayName,
        verificationStatus: number.verificationStatus,
        qualityRating: number.qualityRating,
        messagingStatus: number.messagingStatus,
        platformType: number.platformType,
        throughputLevel: number.throughputLevel,
        catalogVisible: number.catalogVisible,
        cartEnabled: number.cartEnabled,
        status: number.status,
        isDefault: number.isDefault,
      })),
      catalogs: account.catalogs.map((catalog) => ({
        id: catalog.id,
        metaCatalogId: catalog.metaCatalogId,
        name: catalog.name,
        vertical: catalog.vertical,
        currency: catalog.currency,
        status: catalog.status,
        isDefault: catalog.isDefault,
        lastSyncedAt: catalog.lastSyncedAt,
        lastSyncStatus: catalog.lastSyncStatus,
      })),
    };
  }
}
