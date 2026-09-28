import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { MetaConfig } from '../config/configuration';
import { MetaSettingsService } from '../config/meta-settings.service';
import { MetaGraphService } from './meta-graph.service';

export interface MetaSendResult {
  metaMessageId: string;
  waId: string;
}

export interface ProductSection {
  title: string;
  productRetailerIds: string[];
}

/**
 * Outbound WhatsApp Cloud API messages.
 *
 * Every send takes an explicit phoneNumberId and token, so the system can
 * serve several businesses and several numbers without a single global
 * "the" number anywhere.
 */
@Injectable()
export class MetaMessagingService {
  private readonly logger = new Logger('WhatsApp Messaging');

  constructor(
    private readonly graph: MetaGraphService,
    private readonly metaSettings: MetaSettingsService,
  ) {}

  private get meta(): MetaConfig {
    return this.metaSettings.getSettings();
  }

  /** Strips formatting so Meta receives a bare MSISDN (digits only). */
  static normalizePhone(input: string): string {
    return String(input || '').replace(/[^\d]/g, '');
  }

  static maskPhone(phone: string): string {
    const digits = MetaMessagingService.normalizePhone(phone);
    return digits.length > 4 ? `${'*'.repeat(digits.length - 4)}${digits.slice(-4)}` : '****';
  }

  // -----------------------------------------------------------------------
  // Webhook trust
  // -----------------------------------------------------------------------

  /** GET handshake: returns the challenge when the verify token matches. */
  verifyWebhook(mode: string, token: string, challenge: string): string | null {
    if (mode === 'subscribe' && token && token === this.meta.verifyToken) {
      this.logger.log('Webhook verification succeeded');
      return challenge;
    }
    this.logger.warn('Webhook verification failed: mode or verify token mismatch');
    return null;
  }

  /**
   * Validates Meta's X-Hub-Signature-256 against the raw request body.
   *
   * Returns true when no app secret is configured so a local tunnel still
   * works, but says loudly in the log that the check was skipped.
   */
  verifySignature(rawBody: Buffer | undefined, signatureHeader: string | undefined): boolean {
    const secret = this.meta.appSecret;
    if (!secret) {
      this.logger.warn('META_APP_SECRET not set - webhook signature check skipped');
      return true;
    }
    if (!rawBody || !signatureHeader || !signatureHeader.startsWith('sha256=')) return false;

    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    const received = signatureHeader.slice('sha256='.length);
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(received, 'utf8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  // -----------------------------------------------------------------------
  // Sending
  // -----------------------------------------------------------------------

  private async send(
    phoneNumberId: string,
    token: string,
    payload: Record<string, unknown>,
  ): Promise<MetaSendResult> {
    const data = await this.graph.post<any>(
      `${phoneNumberId}/messages`,
      token,
      payload,
      `send ${payload.type} message`,
    );

    const metaMessageId = data?.messages?.[0]?.id;
    const waId = data?.contacts?.[0]?.wa_id || String(payload.to);
    this.logger.log(
      `Sent ${payload.type} to ${MetaMessagingService.maskPhone(String(payload.to))} (${metaMessageId})`,
    );
    return { metaMessageId, waId };
  }

  private envelope(to: string, type: string, content: Record<string, unknown>) {
    return {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: MetaMessagingService.normalizePhone(to),
      type,
      ...content,
    };
  }

  async sendText(params: {
    phoneNumberId: string;
    token: string;
    to: string;
    body: string;
    previewUrl?: boolean;
  }): Promise<MetaSendResult> {
    return this.send(
      params.phoneNumberId,
      params.token,
      this.envelope(params.to, 'text', {
        text: { preview_url: Boolean(params.previewUrl), body: params.body },
      }),
    );
  }

  /** The only way to reach a customer once the 24h window has closed. */
  async sendTemplate(params: {
    phoneNumberId: string;
    token: string;
    to: string;
    templateName: string;
    language?: string;
    components?: unknown[];
  }): Promise<MetaSendResult> {
    const template: Record<string, unknown> = {
      name: params.templateName,
      language: { code: params.language || 'en_US' },
    };
    if (params.components?.length) template.components = params.components;

    return this.send(
      params.phoneNumberId,
      params.token,
      this.envelope(params.to, 'template', { template }),
    );
  }

  /**
   * Uploads bytes to Meta and returns a media id.
   * The Cloud API does not accept raw bytes on /messages - media is always a
   * two-step upload-then-send.
   */
  async uploadMedia(params: {
    phoneNumberId: string;
    token: string;
    file: { buffer: Buffer; originalname: string; mimetype: string };
  }): Promise<string> {
    const data = await this.graph.upload<{ id?: string }>({
      path: `${params.phoneNumberId}/media`,
      token: params.token,
      file: params.file,
      fields: { messaging_product: 'whatsapp', type: params.file.mimetype },
      context: 'upload media',
    });

    if (!data?.id) throw new BadRequestException('Meta did not return a media id for this file.');
    this.logger.log(`Media uploaded (${params.file.mimetype}) -> ${data.id}`);
    return data.id;
  }

  async sendMedia(params: {
    phoneNumberId: string;
    token: string;
    to: string;
    type: 'image' | 'video' | 'audio' | 'document' | 'sticker';
    mediaId?: string;
    /** Public URL alternative to mediaId - handy for product images we host. */
    link?: string;
    caption?: string;
    filename?: string;
  }): Promise<MetaSendResult> {
    const media: Record<string, unknown> = params.mediaId
      ? { id: params.mediaId }
      : { link: params.link };

    // Audio and stickers reject a caption.
    if (params.caption && params.type !== 'audio' && params.type !== 'sticker') {
      media.caption = params.caption;
    }
    if (params.type === 'document' && params.filename) media.filename = params.filename;

    return this.send(
      params.phoneNumberId,
      params.token,
      this.envelope(params.to, params.type, { [params.type]: media }),
    );
  }

  // -----------------------------------------------------------------------
  // Catalog messages
  // -----------------------------------------------------------------------

  /**
   * Single Product Message - one item with a "View" button that opens the
   * product inside WhatsApp.
   */
  async sendProduct(params: {
    phoneNumberId: string;
    token: string;
    to: string;
    catalogId: string;
    productRetailerId: string;
    bodyText?: string;
    footerText?: string;
  }): Promise<MetaSendResult> {
    const interactive: Record<string, unknown> = {
      type: 'product',
      action: {
        catalog_id: params.catalogId,
        product_retailer_id: params.productRetailerId,
      },
    };
    if (params.bodyText) interactive.body = { text: params.bodyText };
    if (params.footerText) interactive.footer = { text: params.footerText };

    return this.send(
      params.phoneNumberId,
      params.token,
      this.envelope(params.to, 'interactive', { interactive }),
    );
  }

  /**
   * Multi-Product Message - up to 30 items across up to 10 sections.
   * Header and body are mandatory for this type.
   */
  async sendProductList(params: {
    phoneNumberId: string;
    token: string;
    to: string;
    catalogId: string;
    headerText: string;
    bodyText: string;
    sections: ProductSection[];
    footerText?: string;
  }): Promise<MetaSendResult> {
    const sections = params.sections
      .map((section) => ({
        title: section.title.slice(0, 24),
        product_items: section.productRetailerIds.map((id) => ({ product_retailer_id: id })),
      }))
      .filter((section) => section.product_items.length > 0)
      .slice(0, 10);

    if (!sections.length) {
      throw new BadRequestException('A product list needs at least one product.');
    }

    const total = sections.reduce((sum, s) => sum + s.product_items.length, 0);
    if (total > 30) {
      throw new BadRequestException(
        'WhatsApp allows at most 30 products in one multi-product message.',
      );
    }

    const interactive: Record<string, unknown> = {
      type: 'product_list',
      header: { type: 'text', text: params.headerText.slice(0, 60) },
      body: { text: params.bodyText },
      action: { catalog_id: params.catalogId, sections },
    };
    if (params.footerText) interactive.footer = { text: params.footerText };

    return this.send(
      params.phoneNumberId,
      params.token,
      this.envelope(params.to, 'interactive', { interactive }),
    );
  }

  /**
   * Catalog Message - opens the whole catalog. The thumbnail product is
   * optional; Meta picks the first item when it is omitted.
   */
  async sendCatalog(params: {
    phoneNumberId: string;
    token: string;
    to: string;
    bodyText: string;
    footerText?: string;
    thumbnailProductRetailerId?: string;
  }): Promise<MetaSendResult> {
    const action: Record<string, unknown> = { name: 'catalog_message' };
    if (params.thumbnailProductRetailerId) {
      action.parameters = { thumbnail_product_retailer_id: params.thumbnailProductRetailerId };
    }

    const interactive: Record<string, unknown> = {
      type: 'catalog_message',
      body: { text: params.bodyText },
      action,
    };
    if (params.footerText) interactive.footer = { text: params.footerText };

    return this.send(
      params.phoneNumberId,
      params.token,
      this.envelope(params.to, 'interactive', { interactive }),
    );
  }

  // -----------------------------------------------------------------------
  // Read receipts and media retrieval
  // -----------------------------------------------------------------------

  /** Best-effort: Meta rejects receipts for older messages, which is fine. */
  async markRead(params: {
    phoneNumberId: string;
    token: string;
    metaMessageId: string;
  }): Promise<void> {
    if (!params.metaMessageId) return;
    try {
      await this.graph.post(
        `${params.phoneNumberId}/messages`,
        params.token,
        {
          messaging_product: 'whatsapp',
          status: 'read',
          message_id: params.metaMessageId,
        },
        'mark message read',
      );
    } catch (err) {
      this.logger.warn(
        `Read receipt not accepted for ${params.metaMessageId}: ${(err as Error).message}`,
      );
    }
  }

  async getMediaUrl(
    token: string,
    mediaId: string,
  ): Promise<{ url: string; mimeType?: string } | null> {
    try {
      const data = await this.graph.get<{ url?: string; mime_type?: string }>(
        mediaId,
        token,
        undefined,
        `resolve media ${mediaId}`,
      );
      return data?.url ? { url: data.url, mimeType: data.mime_type } : null;
    } catch (err) {
      this.logger.warn(`Could not resolve media ${mediaId}: ${(err as Error).message}`);
      return null;
    }
  }

  downloadMedia(url: string, token: string) {
    return this.graph.download(url, token);
  }
}
