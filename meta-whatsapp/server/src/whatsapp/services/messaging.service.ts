import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { MessageStatus } from '@prisma/client';
import { ConversationService } from './conversation.service';
import { WhatsappGateway } from '../whatsapp.gateway';
import { WhatsappService } from './whatsapp.service';

/**
 * Orchestrates an outbound send: enforce the 24h window, call Meta, persist the
 * result (success or failure), then push the row to the inbox in real time.
 */
@Injectable()
export class MessagingService {
  private readonly logger = new Logger('WhatsApp API');

  constructor(
    private readonly whatsapp: WhatsappService,
    private readonly conversations: ConversationService,
    private readonly gateway: WhatsappGateway,
  ) {}

  async sendText(params: { to: string; message: string; sentBy?: string }) {
    const to = WhatsappService.normalizePhone(params.to);
    if (!to) throw new BadRequestException('A valid recipient phone number is required');

    const { conversation } = await this.conversations.resolveConversationForPhone(to);
    const window = ConversationService.windowState(conversation.lastInboundAt);

    // Meta would reject this anyway; failing here gives a clearer reason and
    // avoids burning an API call.
    if (!window.open) {
      throw new BadRequestException({
        statusCode: 400,
        message:
          'The 24-hour customer service window is closed for this customer. Send an approved template message instead.',
        code: 'SERVICE_WINDOW_CLOSED',
        serviceWindow: window,
      });
    }

    return this.dispatch({
      conversationId: conversation.id,
      messageType: 'text',
      messageText: params.message,
      sentBy: params.sentBy,
      send: () => this.whatsapp.sendTextMessage(to, params.message),
    });
  }

  /**
   * Uploads a file to Meta, sends it, and stores it as a media message.
   * Like text, this is only allowed inside the 24h window.
   */
  async sendMedia(params: {
    to: string;
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number };
    caption?: string;
    sentBy?: string;
  }) {
    const to = WhatsappService.normalizePhone(params.to);
    if (!to) throw new BadRequestException('A valid recipient phone number is required');

    const kind = MessagingService.mediaKindFor(params.file.mimetype);
    MessagingService.assertWithinSizeLimit(kind, params.file.size);

    const { conversation } = await this.conversations.resolveConversationForPhone(to);
    const window = ConversationService.windowState(conversation.lastInboundAt);
    if (!window.open) {
      throw new BadRequestException({
        statusCode: 400,
        message:
          'The 24-hour customer service window is closed for this customer. Send an approved template message instead.',
        code: 'SERVICE_WINDOW_CLOSED',
        serviceWindow: window,
      });
    }

    // Upload first: a failure here must not leave a half-written message row.
    const mediaId = await this.whatsapp.uploadMedia(params.file);

    return this.dispatch({
      conversationId: conversation.id,
      messageType: kind,
      messageText: params.caption || MessagingService.LABELS[kind],
      sentBy: params.sentBy,
      media: {
        mediaId,
        mimeType: params.file.mimetype,
        filename: params.file.originalname,
        caption: params.caption,
      },
      send: () =>
        this.whatsapp.sendMediaMessage({
          to,
          type: kind,
          mediaId,
          caption: params.caption,
          filename: params.file.originalname,
        }),
    });
  }

  static readonly LABELS: Record<string, string> = {
    image: 'Photo',
    video: 'Video',
    audio: 'Audio',
    document: 'Document',
    sticker: 'Sticker',
  };

  /** Meta's per-type size ceilings, in bytes. */
  private static readonly SIZE_LIMITS: Record<string, number> = {
    image: 5 * 1024 * 1024,
    video: 16 * 1024 * 1024,
    audio: 16 * 1024 * 1024,
    sticker: 500 * 1024,
    document: 100 * 1024 * 1024,
  };

  /** Maps a MIME type onto the WhatsApp message type that carries it. */
  static mediaKindFor(mimeType: string): 'image' | 'video' | 'audio' | 'document' | 'sticker' {
    const mime = String(mimeType || '').toLowerCase();
    if (mime === 'image/webp') return 'sticker';
    // WhatsApp only accepts jpeg/png as an image; anything else goes as a file.
    if (mime === 'image/jpeg' || mime === 'image/jpg' || mime === 'image/png') return 'image';
    if (mime.startsWith('video/')) return 'video';
    if (mime.startsWith('audio/')) return 'audio';
    return 'document';
  }

  private static assertWithinSizeLimit(kind: string, size: number) {
    const limit = MessagingService.SIZE_LIMITS[kind];
    if (size > limit) {
      const mb = Math.round(limit / (1024 * 1024));
      throw new BadRequestException(
        `This ${kind} is too large. WhatsApp allows up to ${mb >= 1 ? `${mb} MB` : `${Math.round(limit / 1024)} KB`} for a ${kind}.`,
      );
    }
  }

  async sendTemplate(params: {
    to: string;
    templateName: string;
    language?: string;
    components?: unknown[];
    sentBy?: string;
  }) {
    const to = WhatsappService.normalizePhone(params.to);
    if (!to) throw new BadRequestException('A valid recipient phone number is required');

    const { conversation } = await this.conversations.resolveConversationForPhone(to);

    return this.dispatch({
      conversationId: conversation.id,
      messageType: 'template',
      messageText: `[template] ${params.templateName}`,
      sentBy: params.sentBy,
      send: () =>
        this.whatsapp.sendTemplateMessage(
          to,
          params.templateName,
          params.language || 'en_US',
          params.components,
        ),
    });
  }

  /** Marks a thread read locally and mirrors the read receipt to Meta. */
  async markConversationRead(conversationId: string) {
    const { conversation, lastInboundMetaId } = await this.conversations.markRead(conversationId);
    if (lastInboundMetaId) {
      // Fire and forget: a rejected receipt must not fail the request.
      void this.whatsapp.markMessageAsRead(lastInboundMetaId);
    }
    const dto = this.conversations.serializeConversation(conversation);
    this.gateway.emitConversation(dto);
    return dto;
  }

  // ---------------------------------------------------------------------

  /**
   * Shared send path. A Meta rejection is stored as a FAILED message so the
   * admin sees what happened in the thread instead of losing the attempt.
   */
  private async dispatch(params: {
    conversationId: string;
    messageType: string;
    messageText: string;
    sentBy?: string;
    media?: { mediaId: string; mimeType: string; filename: string; caption?: string };
    send: () => Promise<{ metaMessageId: string; waId: string }>;
  }) {
    try {
      const result = await params.send();
      const stored = await this.conversations.recordOutgoingMessage({
        conversationId: params.conversationId,
        metaMessageId: result.metaMessageId,
        messageType: params.messageType,
        messageText: params.messageText,
        status: MessageStatus.SENT,
        sentBy: params.sentBy,
        media: params.media,
      });

      const conversation = await this.conversations.touchConversation(params.conversationId, {
        preview: params.messageText,
        at: stored.timestamp,
        incoming: false,
      });

      const message = this.conversations.serializeMessage(stored);
      const conversationDto = this.conversations.serializeConversation(conversation);

      this.gateway.emitNewMessage({
        conversationId: params.conversationId,
        customer: conversationDto.customer,
        message,
      });
      this.gateway.emitConversation(conversationDto);

      return { success: true, message, conversation: conversationDto };
    } catch (err: any) {
      const response = err && err.response;
      const reason =
        (response && (response.message || response.error)) || err.message || 'Send failed';

      const stored = await this.conversations.recordOutgoingMessage({
        conversationId: params.conversationId,
        messageType: params.messageType,
        messageText: params.messageText,
        status: MessageStatus.FAILED,
        sentBy: params.sentBy,
        media: params.media,
        errorCode: response && response.metaErrorCode ? String(response.metaErrorCode) : null,
        errorTitle: 'Send failed',
        errorMessage: String(reason),
      });

      this.gateway.emitNewMessage({
        conversationId: params.conversationId,
        customer: null,
        message: this.conversations.serializeMessage(stored),
      });

      throw err;
    }
  }
}
