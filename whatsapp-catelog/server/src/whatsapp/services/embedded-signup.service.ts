import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MetaConfig } from '../../config/configuration';
import { CryptoService } from '../../common/crypto.service';
import { MetaBusinessService } from '../../meta/meta-business.service';
import { MetaGraphService } from '../../meta/meta-graph.service';
import { AccountService } from './account.service';

/** Permissions the Embedded Signup flow must request for this system to work. */
export const REQUIRED_SCOPES = [
  'whatsapp_business_management',
  'whatsapp_business_messaging',
  'business_management',
  'catalog_management',
];

/**
 * Meta Embedded Signup.
 *
 * The browser opens Meta's own onboarding window (via the Facebook JS SDK) and
 * gets back a short-lived `code`. That code is the only thing it ever sends
 * us. Everything after it - trading the code for a token, discovering what the
 * token covers, storing it encrypted, subscribing the webhook - happens here,
 * on the server. The app secret and the resulting access token never exist in
 * the browser.
 */
@Injectable()
export class EmbeddedSignupService {
  private readonly logger = new Logger(EmbeddedSignupService.name);

  constructor(
    private readonly graph: MetaGraphService,
    private readonly business: MetaBusinessService,
    private readonly accounts: AccountService,
    private readonly crypto: CryptoService,
    private readonly config: ConfigService,
  ) {}

  private get meta(): MetaConfig {
    return this.config.get<MetaConfig>('meta');
  }

  /**
   * Public, non-secret values the frontend needs to launch the Meta window.
   * The app *id* is public by design; the app *secret* is not and is absent here.
   */
  publicConfig() {
    const { appId, configId, apiVersion } = this.meta;
    const missing: string[] = [];
    if (!appId) missing.push('META_APP_ID');
    if (!configId) missing.push('META_CONFIG_ID');
    if (!this.meta.appSecret) missing.push('META_APP_SECRET');
    if (!this.crypto.isReady) missing.push('ENCRYPTION_KEY');

    return {
      available: missing.length === 0,
      missing,
      appId: appId || null,
      configId: configId || null,
      graphVersion: apiVersion,
      scopes: REQUIRED_SCOPES,
      /** Shown in the UI so the operator can paste it into the Meta app settings. */
      redirectUri: `${this.config.get<string>('publicUrl')}/whatsapp/setup`,
    };
  }

  private assertAvailable() {
    const config = this.publicConfig();
    if (config.available) return;
    throw new ServiceUnavailableException({
      statusCode: 503,
      message:
        `Embedded Signup is not configured on this server. Missing: ${config.missing.join(', ')}. ` +
        'You can still connect an account manually with a System User token.',
      code: 'EMBEDDED_SIGNUP_UNAVAILABLE',
    });
  }

  /**
   * Completes onboarding from the code the Meta window returned.
   *
   * `wabaId` and `phoneNumberId` come from Meta's `WA_EMBEDDED_SIGNUP` message
   * event. They are treated as hints: the token is always re-inspected, so a
   * forged pair cannot make us adopt an account the token has no rights to.
   */
  async complete(params: { code: string; wabaId?: string; phoneNumberId?: string; businessId?: string }) {
    this.assertAvailable();
    if (!params.code) throw new BadRequestException('The Meta authorization code is missing.');

    // 1. Code -> access token (server-side, uses the app secret).
    const exchanged = await this.graph.exchangeCodeForToken(params.code);
    const token = exchanged?.access_token;
    if (!token) {
      throw new BadRequestException('Meta did not return an access token for this authorization.');
    }
    this.logger.log(`Exchanged Embedded Signup code for a token (${CryptoService.fingerprint(token)})`);

    // 2. Inspect the token: what did the user actually grant?
    const debug = await this.graph.debugToken(token).catch((err) => {
      this.logger.warn(`Could not inspect the new token: ${(err as Error).message}`);
      return null;
    });

    const grantedWabaIds = new Set<string>();
    for (const grant of debug?.granular_scopes || []) {
      if (!/whatsapp_business_(management|messaging)/.test(grant.scope)) continue;
      for (const id of grant.target_ids || []) grantedWabaIds.add(id);
    }

    const missingScopes = REQUIRED_SCOPES.filter(
      (scope) => debug?.scopes && !debug.scopes.includes(scope),
    );
    if (missingScopes.length) {
      this.logger.warn(`Embedded Signup granted a token missing: ${missingScopes.join(', ')}`);
    }

    // 3. Decide which WABA to adopt.
    let wabaId = params.wabaId;
    if (wabaId && grantedWabaIds.size && !grantedWabaIds.has(wabaId)) {
      throw new BadRequestException({
        statusCode: 400,
        message:
          'The account returned by the Meta window is not covered by the permissions that were ' +
          'granted. Run the connect flow again and make sure the right business is selected.',
        code: 'WABA_NOT_GRANTED',
      });
    }
    if (!wabaId) wabaId = [...grantedWabaIds][0];
    if (!wabaId) {
      throw new BadRequestException({
        statusCode: 400,
        message:
          'No WhatsApp Business Account was granted during signup. Complete the Meta onboarding ' +
          'steps (including business verification) and try again.',
        code: 'NO_WABA_GRANTED',
      });
    }

    // 4. Persist the account and its encrypted token, then wire the webhook.
    const account = await this.accounts.importFromMeta({
      token,
      wabaId,
      businessId: params.businessId,
      makeDefault: true,
      persistToken: {
        expiresInSeconds: exchanged.expires_in ?? null,
        scopes: debug?.scopes || [],
        tokenType: exchanged.token_type || 'business',
      },
    });

    this.logger.log(`Embedded Signup completed for WABA ${wabaId}`);

    return {
      account,
      warnings: this.warningsFor(account, missingScopes),
    };
  }

  /**
   * Registers a number that arrived through signup but is not yet live.
   * Meta requires the two-step verification PIN at this step.
   */
  async registerNumber(params: { accountId: string; phoneNumberId: string; pin: string }) {
    if (!/^\d{6}$/.test(params.pin || '')) {
      throw new BadRequestException('The two-step verification PIN must be exactly 6 digits.');
    }
    return this.accounts.registerPhoneNumber(params.accountId, params.phoneNumberId, params.pin);
  }

  /**
   * Turns the connected state into the checklist the setup page renders, so
   * the operator sees exactly which Meta step is still outstanding.
   */
  private warningsFor(account: Awaited<ReturnType<AccountService['findAccount']>>, missingScopes: string[]) {
    const warnings: Array<{ code: string; message: string }> = [];

    if (missingScopes.length) {
      warnings.push({
        code: 'MISSING_PERMISSIONS',
        message: `These permissions were not granted: ${missingScopes.join(', ')}. Some features will fail.`,
      });
    }
    if (!account.webhookSubscribed) {
      warnings.push({
        code: 'WEBHOOK_NOT_SUBSCRIBED',
        message:
          'The webhook subscription could not be created. Incoming customer messages will not arrive ' +
          'until it succeeds.',
      });
    }
    if (!account.phoneNumbers.length) {
      warnings.push({
        code: 'NO_PHONE_NUMBER',
        message: 'No phone number is attached to this account yet. Add one in Meta Business Manager.',
      });
    }
    for (const number of account.phoneNumbers) {
      if (number.status === 'PENDING') {
        warnings.push({
          code: 'PHONE_NOT_REGISTERED',
          message: `${number.phoneNumber} still needs to be registered with a 6-digit PIN before it can send messages.`,
        });
      }
    }
    if (!account.catalogs.length) {
      warnings.push({
        code: 'NO_CATALOG',
        message:
          'No product catalog is connected to this account yet. Create or connect one from the Catalog page.',
      });
    }

    return warnings;
  }
}
