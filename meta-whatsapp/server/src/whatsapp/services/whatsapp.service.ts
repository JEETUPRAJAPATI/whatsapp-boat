import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import * as crypto from 'crypto';
import FormData from 'form-data';

export interface MetaSendResult {
  metaMessageId: string;
  waId: string;
}

/**
 * Thin, single-purpose client for the Meta WhatsApp Cloud API.
 *
 * Everything that talks to graph.facebook.com lives here so the access token
 * never leaves this file - it is read from config, attached as a bearer header,
 * and deliberately never included in a log line or an API response.
 */
@Injectable()
export class WhatsappService {
  private readonly logger = new Logger('WhatsApp API');
  private readonly http: AxiosInstance;

  constructor(private readonly config: ConfigService) {
    this.http = axios.create({ timeout: 20_000 });
  }

  private get meta() {
    return this.config.get('meta') as {
      accessToken: string;
      phoneNumberId: string;
      businessAccountId: string;
      apiVersion: string;
      verifyToken: string;
      appSecret: string;
    };
  }

  get isConfigured(): boolean {
    return Boolean(this.meta.accessToken && this.meta.phoneNumberId);
  }

  /** Non-sensitive config summary, safe to hand to the admin UI. */
  get publicConfig() {
    return {
      configured: this.isConfigured,
      phoneNumberId: this.meta.phoneNumberId || null,
      businessAccountId: this.meta.businessAccountId || null,
      apiVersion: this.meta.apiVersion,
      hasAppSecret: Boolean(this.meta.appSecret),
    };
  }

  private get messagesUrl(): string {
    const { apiVersion, phoneNumberId } = this.meta;
    return `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;
  }

  private get authHeaders() {
    return {
      Authorization: `Bearer ${this.meta.accessToken}`,
      'Content-Type': 'application/json',
    };
  }

  // ---------------------------------------------------------------------
  // Webhook verification
  // ---------------------------------------------------------------------

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
   * Validates Meta's X-Hub-Signature-256 header against the raw request body.
   * Returns true when no app secret is configured so local tunnel testing still
   * works, but logs that the check was skipped.
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

  // ---------------------------------------------------------------------
  // Outbound messages
  // ---------------------------------------------------------------------

  /** Strips formatting so Meta receives a bare MSISDN (digits only). */
  static normalizePhone(input: string): string {
    return String(input || '').replace(/[^\d]/g, '');
  }

  async sendTextMessage(to: string, body: string, previewUrl = false): Promise<MetaSendResult> {
    return this.post({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: WhatsappService.normalizePhone(to),
      type: 'text',
      text: { preview_url: previewUrl, body },
    });
  }

  /**
   * Template send - the only way to reach a customer once the 24h
   * customer-service window has closed.
   */
  async sendTemplateMessage(
    to: string,
    templateName: string,
    language = 'en_US',
    components?: unknown[],
  ): Promise<MetaSendResult> {
    const template: Record<string, unknown> = {
      name: templateName,
      language: { code: language },
    };
    if (components && components.length) template.components = components;

    return this.post({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: WhatsappService.normalizePhone(to),
      type: 'template',
      template,
    });
  }

  /**
   * Uploads bytes to Meta and returns the media id used when sending.
   * Media must be uploaded first - the Cloud API does not accept raw bytes on
   * the /messages endpoint.
   */
  async uploadMedia(file: {
    buffer: Buffer;
    originalname: string;
    mimetype: string;
  }): Promise<string> {
    if (!this.isConfigured) {
      throw new ServiceUnavailableException(
        'WhatsApp is not configured. Set META_WHATSAPP_ACCESS_TOKEN and META_WHATSAPP_PHONE_NUMBER_ID.',
      );
    }

    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', file.mimetype);
    form.append('file', file.buffer, {
      filename: file.originalname,
      contentType: file.mimetype,
    });

    try {
      const { data } = await this.http.post(
        `https://graph.facebook.com/${this.meta.apiVersion}/${this.meta.phoneNumberId}/media`,
        form,
        {
          headers: { Authorization: `Bearer ${this.meta.accessToken}`, ...form.getHeaders() },
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
        },
      );
      if (!data || !data.id) throw new BadRequestException('Meta did not return a media id');
      this.logger.log(`Media uploaded (${file.mimetype}, ${file.buffer.length} bytes) -> ${data.id}`);
      return data.id;
    } catch (err) {
      throw this.toMediaError(err);
    }
  }

  /** Sends a previously uploaded media object to a customer. */
  async sendMediaMessage(params: {
    to: string;
    type: 'image' | 'video' | 'audio' | 'document' | 'sticker';
    mediaId: string;
    caption?: string;
    filename?: string;
  }): Promise<MetaSendResult> {
    const media: Record<string, unknown> = { id: params.mediaId };
    // Only documents and visual media accept these fields.
    if (params.caption && params.type !== 'audio' && params.type !== 'sticker') {
      media.caption = params.caption;
    }
    if (params.type === 'document' && params.filename) media.filename = params.filename;

    return this.post({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: WhatsappService.normalizePhone(params.to),
      type: params.type,
      [params.type]: media,
    });
  }

  private toMediaError(err: unknown) {
    const metaError = axios.isAxiosError(err)
      ? err.response && err.response.data && err.response.data.error
      : undefined;
    const detail: string = (metaError && metaError.message) || '';
    this.logger.error(`Media upload failed - ${detail || (err as Error).message}`);

    if (axios.isAxiosError(err) && err.response && err.response.status === 401) {
      return new ServiceUnavailableException('WhatsApp access token is invalid or expired.');
    }
    return new BadRequestException(
      detail || 'WhatsApp rejected this file. Check the file type and size limits.',
    );
  }

  /** Tells Meta the customer's message was read (blue ticks on their phone). */
  async markMessageAsRead(metaMessageId: string): Promise<void> {
    if (!this.isConfigured || !metaMessageId) return;
    try {
      await this.http.post(
        this.messagesUrl,
        { messaging_product: 'whatsapp', status: 'read', message_id: metaMessageId },
        { headers: this.authHeaders },
      );
    } catch (err) {
      // Read receipts are best-effort: Meta rejects them for older messages,
      // which must not break marking a thread read locally.
      this.logger.warn(`Read receipt not accepted for ${metaMessageId}: ${this.reason(err)}`);
    }
  }

  /** Resolves a media id to a short-lived download URL. */
  async getMediaUrl(mediaId: string): Promise<{ url: string; mimeType?: string } | null> {
    if (!this.isConfigured) return null;
    try {
      const { data } = await this.http.get(
        `https://graph.facebook.com/${this.meta.apiVersion}/${mediaId}`,
        { headers: { Authorization: `Bearer ${this.meta.accessToken}` } },
      );
      return { url: data && data.url, mimeType: data && data.mime_type };
    } catch (err) {
      this.logger.warn(`Could not resolve media ${mediaId}: ${this.reason(err)}`);
      return null;
    }
  }

  /** Downloads media bytes; the URL from getMediaUrl also needs the token. */
  async downloadMedia(url: string): Promise<{ buffer: Buffer; contentType: string }> {
    const res = await this.http.get(url, {
      headers: { Authorization: `Bearer ${this.meta.accessToken}` },
      responseType: 'arraybuffer',
    });
    return {
      buffer: Buffer.from(res.data),
      contentType: String(res.headers['content-type'] || 'application/octet-stream'),
    };
  }

  // ---------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------

  private async post(payload: Record<string, unknown>): Promise<MetaSendResult> {
    if (!this.isConfigured) {
      throw new ServiceUnavailableException(
        'WhatsApp is not configured. Set META_WHATSAPP_ACCESS_TOKEN and META_WHATSAPP_PHONE_NUMBER_ID.',
      );
    }

    try {
      const { data } = await this.http.post(this.messagesUrl, payload, {
        headers: this.authHeaders,
      });
      const metaMessageId = data && data.messages && data.messages[0] && data.messages[0].id;
      const waId =
        (data && data.contacts && data.contacts[0] && data.contacts[0].wa_id) || String(payload.to);
      this.logger.log(`Message sent to ${this.maskPhone(String(payload.to))} (${metaMessageId})`);
      return { metaMessageId, waId };
    } catch (err) {
      throw this.toHttpError(err, String(payload.to));
    }
  }

  /**
   * Turns a Graph API failure into a clean client-facing error. Meta's raw
   * payload (which can echo request details) never reaches the frontend.
   */
  private toHttpError(err: unknown, to: string) {
    const metaError = axios.isAxiosError(err) ? err.response && err.response.data && err.response.data.error : undefined;
    const status = axios.isAxiosError(err) ? err.response && err.response.status : undefined;
    const code = metaError && metaError.code;
    const detail: string = (metaError && (metaError.error_user_title || metaError.message)) || '';

    this.logger.error(
      `Message failed to ${this.maskPhone(to)} - status=${status || 'n/a'} code=${code || 'n/a'} ${detail}`,
    );

    const wrap = (message: string) =>
      new BadRequestException({ message, metaErrorCode: code || null, statusCode: 400 });

    if (status === 401 || code === 190) {
      return new ServiceUnavailableException(
        'WhatsApp access token is invalid or expired. Update META_WHATSAPP_ACCESS_TOKEN.',
      );
    }
    if (code === 100 && /phone_number_id|object/i.test(detail)) {
      return new ServiceUnavailableException('WhatsApp phone number id is invalid.');
    }
    if (code === 131026) {
      return wrap('This number cannot receive WhatsApp messages (not a WhatsApp account).');
    }
    if (code === 131047 || code === 131051) {
      return wrap(
        'The 24-hour customer service window is closed. Send an approved template message instead.',
      );
    }
    if (code === 132000 || code === 132001 || code === 132012 || code === 132015) {
      return wrap(
        'Template rejected by Meta: it may not exist, not be approved, or the parameters do not match.',
      );
    }
    if (code === 130429 || status === 429) {
      return wrap('Meta rate limit reached. Try again shortly.');
    }
    if (code === 131021) {
      return wrap('Recipient number is the same as the sender number.');
    }
    if (!status) {
      return new BadGatewayException(
        'Could not reach the WhatsApp API. Check network connectivity.',
      );
    }
    return wrap(detail || 'WhatsApp rejected this message.');
  }

  private reason(err: unknown): string {
    if (axios.isAxiosError(err)) {
      const metaMessage =
        err.response && err.response.data && err.response.data.error && err.response.data.error.message;
      return metaMessage || err.message;
    }
    return (err as Error) ? (err as Error).message : 'unknown error';
  }

  private maskPhone(phone: string): string {
    const digits = WhatsappService.normalizePhone(phone);
    return digits.length > 4 ? `${'*'.repeat(digits.length - 4)}${digits.slice(-4)}` : '****';
  }
}
