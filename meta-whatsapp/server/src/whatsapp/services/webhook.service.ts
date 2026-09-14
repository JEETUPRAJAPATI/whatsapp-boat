import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MessageStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsappGateway } from '../whatsapp.gateway';
import { ConversationService } from './conversation.service';

/** Shape of one parsed inbound message, independent of Meta's wire format. */
interface ParsedMessage {
  metaMessageId: string;
  from: string;
  type: string;
  text?: string;
  caption?: string;
  mediaId?: string;
  mediaMimeType?: string;
  mediaFilename?: string;
  contextId?: string;
  timestamp: Date;
}

const STATUS_MAP: Record<string, MessageStatus> = {
  sent: MessageStatus.SENT,
  delivered: MessageStatus.DELIVERED,
  read: MessageStatus.READ,
  failed: MessageStatus.FAILED,
};

/**
 * Translates Meta webhook payloads into database rows and socket events.
 *
 * Meta retries a webhook it thinks failed, so every path here is idempotent:
 * inbound messages are keyed on meta_message_id and status updates only move
 * a message forward.
 */
@Injectable()
export class WebhookService {
  private readonly logger = new Logger('WhatsApp Webhook');

  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationService,
    private readonly gateway: WhatsappGateway,
    private readonly config: ConfigService,
  ) {}

  /**
   * Entry point for POST /api/whatsapp/webhook. Never throws: Meta disables a
   * webhook that keeps returning errors, so failures are logged and swallowed.
   */
  async processWebhook(body: any): Promise<{ processed: number }> {
    let processed = 0;

    if (!body || body.object !== 'whatsapp_business_account') {
      this.logger.warn('Ignoring webhook with unexpected object type');
      return { processed };
    }

    for (const entry of body.entry || []) {
      const businessAccountId = entry.id;

      for (const change of entry.changes || []) {
        if (change.field !== 'messages') continue;
        const value = change.value || {};
        const phoneNumberId = value.metadata && value.metadata.phone_number_id;

        await this.log('messages', { businessAccountId, phoneNumberId, value });

        // Contacts arrive alongside messages and carry the WhatsApp profile name.
        const profileNames = new Map<string, string>();
        for (const contact of value.contacts || []) {
          const name = contact.profile && contact.profile.name;
          if (contact.wa_id && name) profileNames.set(String(contact.wa_id), name);
        }

        for (const raw of value.messages || []) {
          try {
            // Duplicates return false, so `processed` reflects real work done.
            if (await this.handleIncomingMessage(raw, profileNames)) processed++;
          } catch (err) {
            this.logger.error(`Failed to store message ${raw && raw.id}: ${(err as Error).message}`);
          }
        }

        for (const status of value.statuses || []) {
          try {
            await this.processStatusUpdate(status);
            processed++;
          } catch (err) {
            this.logger.error(`Failed to apply status update: ${(err as Error).message}`);
          }
        }

        for (const error of value.errors || []) {
          this.logger.error(
            `Account-level error from Meta: code=${error.code} ${error.title || ''}`,
          );
        }
      }
    }

    return { processed };
  }

  // ---------------------------------------------------------------------
  // Incoming messages
  // ---------------------------------------------------------------------

  private async handleIncomingMessage(
    raw: any,
    profileNames: Map<string, string>,
  ): Promise<boolean> {
    const parsed = this.parseMessage(raw);
    if (!parsed) return false;

    const customer = await this.conversations.upsertCustomer({
      phoneNumber: parsed.from,
      profileName: profileNames.get(parsed.from),
      waId: parsed.from,
    });
    const conversation = await this.conversations.getOrCreateConversation(
      customer.id,
      parsed.from,
    );

    const stored = await this.conversations.recordIncomingMessage({
      conversationId: conversation.id,
      metaMessageId: parsed.metaMessageId,
      messageType: parsed.type,
      messageText: parsed.text,
      mediaId: parsed.mediaId,
      mediaMimeType: parsed.mediaMimeType,
      mediaFilename: parsed.mediaFilename,
      caption: parsed.caption,
      contextId: parsed.contextId,
      timestamp: parsed.timestamp,
      rawPayload: raw,
    });

    // Duplicate delivery: already stored, nothing to broadcast.
    if (!stored) return false;

    this.logger.log(
      `Incoming message ${parsed.metaMessageId} (${parsed.type}) from ${this.mask(parsed.from)}`,
    );

    const updated = await this.conversations.touchConversation(conversation.id, {
      preview: this.previewFor(parsed),
      at: parsed.timestamp,
      incoming: true,
    });

    const conversationDto = this.conversations.serializeConversation(updated);
    this.gateway.emitNewMessage({
      conversationId: conversation.id,
      customer: conversationDto.customer,
      message: this.conversations.serializeMessage(stored),
    });
    this.gateway.emitConversation(conversationDto);
    return true;
  }

  /**
   * Normalizes every supported message type into one flat shape. Adding a new
   * type is a single case here - the rest of the pipeline is type-agnostic.
   */
  private parseMessage(raw: any): ParsedMessage | null {
    if (!raw || !raw.id || !raw.from) return null;

    const base: ParsedMessage = {
      metaMessageId: String(raw.id),
      from: String(raw.from),
      type: String(raw.type || 'unknown'),
      timestamp: this.toDate(raw.timestamp),
      contextId: raw.context && raw.context.id ? String(raw.context.id) : undefined,
    };

    switch (raw.type) {
      case 'text':
        return { ...base, text: raw.text && raw.text.body };

      case 'image':
      case 'video':
      case 'audio':
      case 'sticker':
      case 'document': {
        const media = raw[raw.type] || {};
        return {
          ...base,
          mediaId: media.id,
          mediaMimeType: media.mime_type,
          mediaFilename: media.filename,
          caption: media.caption,
          text: media.caption || null,
        };
      }

      case 'location': {
        const loc = raw.location || {};
        const label = [loc.name, loc.address].filter(Boolean).join(', ');
        return {
          ...base,
          text: label || `${loc.latitude}, ${loc.longitude}`,
        };
      }

      case 'contacts': {
        const names = (raw.contacts || [])
          .map((c: any) => (c.name && c.name.formatted_name) || '')
          .filter(Boolean);
        return { ...base, text: names.join(', ') || 'Shared a contact' };
      }

      case 'interactive': {
        const i = raw.interactive || {};
        const reply = i.button_reply || i.list_reply || {};
        return { ...base, text: reply.title || reply.id || 'Interactive reply' };
      }

      case 'button':
        return { ...base, text: (raw.button && raw.button.text) || 'Button reply' };

      case 'reaction':
        return {
          ...base,
          text: raw.reaction && raw.reaction.emoji,
          contextId: (raw.reaction && raw.reaction.message_id) || base.contextId,
        };

      case 'order':
        return { ...base, text: 'Order received' };

      case 'system':
        return { ...base, text: (raw.system && raw.system.body) || 'System message' };

      case 'unsupported':
        return { ...base, text: 'Unsupported message type' };

      default:
        this.logger.warn(`Unhandled message type "${raw.type}" stored as-is`);
        return { ...base, text: null };
    }
  }

  private previewFor(parsed: ParsedMessage): string {
    if (parsed.text) return parsed.text;
    const labels: Record<string, string> = {
      image: 'Photo',
      video: 'Video',
      audio: 'Audio',
      document: 'Document',
      sticker: 'Sticker',
      location: 'Location',
      contacts: 'Contact',
      reaction: 'Reaction',
    };
    return labels[parsed.type] || parsed.type;
  }

  // ---------------------------------------------------------------------
  // Status updates
  // ---------------------------------------------------------------------

  async processStatusUpdate(status: any) {
    const metaMessageId = status && status.id;
    const mapped = STATUS_MAP[status && status.status];
    if (!metaMessageId || !mapped) return;

    const error = (status.errors && status.errors[0]) || null;
    const updated = await this.conversations.applyStatusUpdate({
      metaMessageId,
      status: mapped,
      errorCode: error ? String(error.code) : undefined,
      errorTitle: error ? error.title : undefined,
      errorMessage: error ? error.error_data && error.error_data.details : undefined,
    });

    if (!updated) {
      // Common and harmless: a status for a message this app never sent.
      this.logger.debug(`Status for unknown message ${metaMessageId} ignored`);
      return;
    }

    this.logger.log(
      `Status update ${metaMessageId} -> ${mapped}${error ? ` (code ${error.code})` : ''}`,
    );

    this.gateway.emitMessageStatus({
      conversationId: updated.conversationId,
      metaMessageId,
      status: updated.status,
      error: error
        ? {
            code: String(error.code),
            title: error.title,
            message: error.error_data && error.error_data.details,
          }
        : null,
    });
  }

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------

  /** Meta sends unix seconds as a string. */
  private toDate(timestamp: unknown): Date {
    const seconds = Number(timestamp);
    if (!Number.isFinite(seconds) || seconds <= 0) return new Date();
    return new Date(seconds * 1000);
  }

  /** Raw payload archive for debugging. Never contains an access token. */
  private async log(eventType: string, payload: unknown) {
    if (!this.config.get<boolean>('webhookLogging')) return;
    try {
      await this.prisma.webhookLog.create({
        data: { eventType, payload: payload as any },
      });
    } catch (err) {
      this.logger.debug(`Webhook log skipped: ${(err as Error).message}`);
    }
  }

  private mask(phone: string): string {
    return phone.length > 4 ? `${'*'.repeat(phone.length - 4)}${phone.slice(-4)}` : '****';
  }
}
