import { Injectable, Logger } from '@nestjs/common';
import { MetaGraphService } from './meta-graph.service';

export interface MetaBusiness {
  id: string;
  name: string;
  verification_status?: string;
  timezone_id?: number;
}

export interface MetaWaba {
  id: string;
  name: string;
  currency?: string;
  timezone_id?: string;
  account_review_status?: string;
  business_verification_status?: string;
  owner_business_info?: { id: string; name: string };
}

export interface MetaPhoneNumber {
  id: string;
  display_phone_number: string;
  verified_name?: string;
  code_verification_status?: string;
  quality_rating?: string;
  platform_type?: string;
  status?: string;
  name_status?: string;
  throughput?: { level?: string };
  messaging_limit_tier?: string;
}

const WABA_FIELDS = [
  'id',
  'name',
  'currency',
  'timezone_id',
  'account_review_status',
  'owner_business_info',
].join(',');

const PHONE_FIELDS = [
  'id',
  'display_phone_number',
  'verified_name',
  'code_verification_status',
  'quality_rating',
  'platform_type',
  'status',
  'name_status',
  'throughput',
  'messaging_limit_tier',
].join(',');

/**
 * Read and write operations against a Business Portfolio, its WhatsApp
 * Business Accounts, and the phone numbers on them.
 *
 * This is the "onboarding" half of the Meta integration: everything needed to
 * discover what an access token can see, register a number, and wire up the
 * webhook. It is all official Graph API - there is no WhatsApp Web automation
 * anywhere in this codebase.
 */
@Injectable()
export class MetaBusinessService {
  private readonly logger = new Logger('Meta Business');

  constructor(private readonly graph: MetaGraphService) {}

  // -----------------------------------------------------------------------
  // Discovery
  // -----------------------------------------------------------------------

  /** Business Portfolios this token can administer. */
  async listBusinesses(token: string): Promise<MetaBusiness[]> {
    return this.graph.paginate<MetaBusiness>(
      'me/businesses',
      token,
      { fields: 'id,name,verification_status,timezone_id' },
      { context: 'list businesses' },
    );
  }

  /**
   * WABAs under a business. Meta splits these into two edges - accounts the
   * business owns, and accounts another business shared with it - and an
   * operator thinks of both as "my accounts", so both are merged here.
   */
  async listWabasForBusiness(token: string, businessId: string): Promise<MetaWaba[]> {
    const edges = ['owned_whatsapp_business_accounts', 'client_whatsapp_business_accounts'];
    const seen = new Map<string, MetaWaba>();

    for (const edge of edges) {
      try {
        const rows = await this.graph.paginate<MetaWaba>(
          `${businessId}/${edge}`,
          token,
          { fields: WABA_FIELDS },
          { context: `list ${edge}` },
        );
        for (const row of rows) seen.set(row.id, row);
      } catch (err) {
        // A token often has one edge and not the other; that is not a failure.
        this.logger.warn(`Could not read ${edge} for business ${businessId}: ${(err as Error).message}`);
      }
    }

    return [...seen.values()];
  }

  /**
   * WABAs reachable from the token itself, used when the operator has a System
   * User token that never sees `me/businesses`.
   */
  async listWabasForToken(token: string): Promise<MetaWaba[]> {
    const debug = await this.graph.debugToken(token).catch(() => null);
    const ids = new Set<string>();

    for (const grant of debug?.granular_scopes || []) {
      if (!/whatsapp_business_(management|messaging)/.test(grant.scope)) continue;
      for (const id of grant.target_ids || []) ids.add(id);
    }

    const accounts: MetaWaba[] = [];
    for (const id of ids) {
      try {
        accounts.push(await this.getWaba(token, id));
      } catch {
        // The grant can list ids the token can no longer read; skip those.
      }
    }
    return accounts;
  }

  async getWaba(token: string, wabaId: string): Promise<MetaWaba> {
    return this.graph.get<MetaWaba>(wabaId, token, { fields: WABA_FIELDS }, `get WABA ${wabaId}`);
  }

  async listPhoneNumbers(token: string, wabaId: string): Promise<MetaPhoneNumber[]> {
    return this.graph.paginate<MetaPhoneNumber>(
      `${wabaId}/phone_numbers`,
      token,
      { fields: PHONE_FIELDS },
      { context: `list phone numbers for ${wabaId}` },
    );
  }

  async getPhoneNumber(token: string, phoneNumberId: string): Promise<MetaPhoneNumber> {
    return this.graph.get<MetaPhoneNumber>(
      phoneNumberId,
      token,
      { fields: PHONE_FIELDS },
      `get phone number ${phoneNumberId}`,
    );
  }

  // -----------------------------------------------------------------------
  // Phone number onboarding
  // -----------------------------------------------------------------------

  /**
   * Asks Meta to send a verification code to the number.
   *
   * Only needed for a number being added manually. A number that arrived
   * through Embedded Signup is already verified and should go straight to
   * register().
   */
  async requestVerificationCode(
    token: string,
    phoneNumberId: string,
    codeMethod: 'SMS' | 'VOICE' = 'SMS',
    language = 'en',
  ): Promise<{ success: boolean }> {
    return this.graph.post(
      `${phoneNumberId}/request_code`,
      token,
      { code_method: codeMethod, language },
      `request verification code for ${phoneNumberId}`,
    );
  }

  async verifyCode(token: string, phoneNumberId: string, code: string): Promise<{ success: boolean }> {
    return this.graph.post(
      `${phoneNumberId}/verify_code`,
      token,
      { code },
      `verify code for ${phoneNumberId}`,
    );
  }

  /**
   * Registers the number on the Cloud API with a two-step verification PIN.
   * This is the step that makes a number able to send and receive.
   */
  async register(token: string, phoneNumberId: string, pin: string): Promise<{ success: boolean }> {
    return this.graph.post(
      `${phoneNumberId}/register`,
      token,
      { messaging_product: 'whatsapp', pin },
      `register phone number ${phoneNumberId}`,
    );
  }

  async deregister(token: string, phoneNumberId: string): Promise<{ success: boolean }> {
    return this.graph.post(
      `${phoneNumberId}/deregister`,
      token,
      {},
      `deregister phone number ${phoneNumberId}`,
    );
  }

  // -----------------------------------------------------------------------
  // Webhook subscription
  // -----------------------------------------------------------------------

  /**
   * Subscribes our app to a WABA's webhooks. Without this, Meta accepts the
   * webhook URL but never delivers a customer message to it.
   */
  async subscribeApp(token: string, wabaId: string): Promise<{ success: boolean }> {
    const result = await this.graph.post<{ success: boolean }>(
      `${wabaId}/subscribed_apps`,
      token,
      {},
      `subscribe app to WABA ${wabaId}`,
    );
    this.logger.log(`Subscribed to webhooks for WABA ${wabaId}`);
    return result;
  }

  async listSubscribedApps(token: string, wabaId: string): Promise<Array<{ whatsapp_business_api_data?: { id?: string; name?: string } }>> {
    const response = await this.graph.get<{ data?: any[] }>(
      `${wabaId}/subscribed_apps`,
      token,
      undefined,
      `list subscribed apps for ${wabaId}`,
    );
    return response?.data || [];
  }

  /** True when *our* app id appears in the WABA's subscriber list. */
  async isSubscribed(token: string, wabaId: string): Promise<boolean> {
    const appId = this.graph.meta.appId;
    try {
      const apps = await this.listSubscribedApps(token, wabaId);
      if (!apps.length) return false;
      if (!appId) return true; // Cannot identify ourselves; at least one app is subscribed.
      return apps.some((app) => String(app?.whatsapp_business_api_data?.id) === String(appId));
    } catch (err) {
      this.logger.warn(`Could not read webhook subscription for ${wabaId}: ${(err as Error).message}`);
      return false;
    }
  }

  async unsubscribeApp(token: string, wabaId: string): Promise<{ success: boolean }> {
    return this.graph.delete(
      `${wabaId}/subscribed_apps`,
      token,
      undefined,
      `unsubscribe app from WABA ${wabaId}`,
    );
  }

  // -----------------------------------------------------------------------
  // Commerce settings - controls whether the catalog is visible in chat
  // -----------------------------------------------------------------------

  async getCommerceSettings(
    token: string,
    phoneNumberId: string,
  ): Promise<{ is_catalog_visible?: boolean; is_cart_enabled?: boolean } | null> {
    try {
      const response = await this.graph.get<{ data?: any[] }>(
        `${phoneNumberId}/whatsapp_commerce_settings`,
        token,
        undefined,
        `get commerce settings for ${phoneNumberId}`,
      );
      return response?.data?.[0] || null;
    } catch (err) {
      // Numbers without a connected catalog return an error here; that is a
      // legitimate state, not a fault worth surfacing.
      this.logger.warn(
        `Commerce settings unavailable for ${phoneNumberId}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  async updateCommerceSettings(
    token: string,
    phoneNumberId: string,
    settings: { isCatalogVisible?: boolean; isCartEnabled?: boolean },
  ): Promise<{ success: boolean }> {
    const body: Record<string, unknown> = {};
    if (settings.isCatalogVisible !== undefined) body.is_catalog_visible = settings.isCatalogVisible;
    if (settings.isCartEnabled !== undefined) body.is_cart_enabled = settings.isCartEnabled;

    return this.graph.post(
      `${phoneNumberId}/whatsapp_commerce_settings`,
      token,
      body,
      `update commerce settings for ${phoneNumberId}`,
    );
  }
}
