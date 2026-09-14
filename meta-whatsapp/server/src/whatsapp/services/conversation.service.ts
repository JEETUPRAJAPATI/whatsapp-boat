import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  ConversationStatus,
  MessageDirection,
  MessageStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** Meta's customer service window: free-form text is allowed inside 24h. */
export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface UpsertCustomerInput {
  phoneNumber: string;
  profileName?: string;
  waId?: string;
}

/**
 * Owns every read and write against customers / conversations / messages.
 * The webhook path and the admin API path both go through here so the two can
 * never drift apart on things like unread counts or the service window.
 */
@Injectable()
export class ConversationService {
  private readonly logger = new Logger(ConversationService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------
  // Customers and conversations
  // ---------------------------------------------------------------------

  async upsertCustomer(input: UpsertCustomerInput) {
    const { phoneNumber, profileName, waId } = input;
    return this.prisma.customer.upsert({
      where: { phoneNumber },
      // Only overwrite the profile name when Meta actually sent one.
      update: profileName ? { profileName, waId: waId || undefined } : { waId: waId || undefined },
      create: { phoneNumber, profileName: profileName || null, waId: waId || phoneNumber },
    });
  }

  /** Finds the customer's conversation, creating one on first contact. */
  async getOrCreateConversation(customerId: string, phoneNumber: string) {
    const existing = await this.prisma.conversation.findFirst({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) return existing;

    return this.prisma.conversation.create({
      data: { customerId, phoneNumber, status: ConversationStatus.OPEN },
    });
  }

  async findConversation(id: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id },
      include: { customer: true },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');
    return conversation;
  }

  async findMessage(id: string) {
    const message = await this.prisma.message.findUnique({ where: { id } });
    if (!message) throw new NotFoundException('Message not found');
    return message;
  }

  /** Resolves an outbound recipient to a conversation, creating one if needed. */
  async resolveConversationForPhone(phoneNumber: string) {
    const customer = await this.upsertCustomer({ phoneNumber });
    const conversation = await this.getOrCreateConversation(customer.id, phoneNumber);
    return { customer, conversation };
  }

  async listConversations(params: { search?: string; status?: ConversationStatus; take?: number }) {
    const { search, status, take = 100 } = params;
    const where: Prisma.ConversationWhereInput = {};
    if (status) where.status = status;
    if (search && search.trim()) {
      const q = search.trim();
      where.OR = [
        { phoneNumber: { contains: q, mode: 'insensitive' } },
        { lastMessage: { contains: q, mode: 'insensitive' } },
        { customer: { name: { contains: q, mode: 'insensitive' } } },
        { customer: { profileName: { contains: q, mode: 'insensitive' } } },
      ];
    }

    const conversations = await this.prisma.conversation.findMany({
      where,
      include: { customer: true },
      orderBy: [{ lastMessageAt: 'desc' }, { updatedAt: 'desc' }],
      take,
    });
    return conversations.map((c) => this.serializeConversation(c));
  }

  async listMessages(conversationId: string, opts: { limit?: number; before?: string } = {}) {
    const limit = Math.min(Math.max(opts.limit || 50, 1), 100);
    await this.findConversation(conversationId);

    const where: Prisma.MessageWhereInput = { conversationId };
    if (opts.before) {
      // Cursor is the id of the oldest message already on screen.
      const cursor = await this.prisma.message.findUnique({ where: { id: opts.before } });
      if (cursor) where.timestamp = { lt: cursor.timestamp };
    }

    // Fetch newest-first so the cursor works, then flip for display order.
    const rows = await this.prisma.message.findMany({
      where,
      orderBy: [{ timestamp: 'desc' }, { createdAt: 'desc' }],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return {
      items: page.reverse().map((m) => this.serializeMessage(m)),
      hasMore,
    };
  }

  // ---------------------------------------------------------------------
  // Messages
  // ---------------------------------------------------------------------

  /**
   * Idempotent insert for inbound messages. Returns null when the same
   * meta_message_id was already stored, which is how duplicate webhook
   * deliveries from Meta are ignored.
   */
  async recordIncomingMessage(data: {
    conversationId: string;
    metaMessageId: string;
    messageType: string;
    messageText?: string;
    mediaId?: string;
    mediaMimeType?: string;
    mediaFilename?: string;
    caption?: string;
    contextId?: string;
    timestamp: Date;
    rawPayload: unknown;
  }) {
    const existing = await this.prisma.message.findUnique({
      where: { metaMessageId: data.metaMessageId },
    });
    if (existing) {
      this.logger.debug(`Duplicate webhook ignored for ${data.metaMessageId}`);
      return null;
    }

    try {
      return await this.prisma.message.create({
        data: {
          conversationId: data.conversationId,
          metaMessageId: data.metaMessageId,
          direction: MessageDirection.INCOMING,
          messageType: data.messageType,
          messageText: data.messageText || null,
          mediaId: data.mediaId || null,
          mediaMimeType: data.mediaMimeType || null,
          mediaFilename: data.mediaFilename || null,
          caption: data.caption || null,
          contextId: data.contextId || null,
          status: MessageStatus.RECEIVED,
          timestamp: data.timestamp,
          rawPayload: data.rawPayload as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      // Two webhook deliveries can race past the findUnique above; the unique
      // index is the real guarantee, so treat P2002 as "already handled".
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        this.logger.debug(`Duplicate webhook race ignored for ${data.metaMessageId}`);
        return null;
      }
      throw err;
    }
  }

  async recordOutgoingMessage(data: {
    conversationId: string;
    metaMessageId?: string;
    messageType: string;
    messageText?: string;
    status?: MessageStatus;
    sentBy?: string;
    media?: { mediaId: string; mimeType: string; filename: string; caption?: string };
    errorCode?: string;
    errorTitle?: string;
    errorMessage?: string;
    rawPayload?: unknown;
  }) {
    return this.prisma.message.create({
      data: {
        conversationId: data.conversationId,
        metaMessageId: data.metaMessageId || null,
        direction: MessageDirection.OUTGOING,
        messageType: data.messageType,
        messageText: data.messageText || null,
        mediaId: data.media ? data.media.mediaId : null,
        mediaMimeType: data.media ? data.media.mimeType : null,
        mediaFilename: data.media ? data.media.filename : null,
        caption: data.media && data.media.caption ? data.media.caption : null,
        status: data.status || MessageStatus.SENT,
        sentBy: data.sentBy || null,
        errorCode: data.errorCode || null,
        errorTitle: data.errorTitle || null,
        errorMessage: data.errorMessage || null,
        timestamp: new Date(),
        rawPayload: (data.rawPayload as Prisma.InputJsonValue) ?? undefined,
      },
    });
  }

  /**
   * Applies a Meta status webhook. Statuses can arrive out of order, so a
   * lower-ranked status never overwrites a higher one (delivered stays
   * delivered when a late "sent" shows up).
   */
  async applyStatusUpdate(input: {
    metaMessageId: string;
    status: MessageStatus;
    errorCode?: string;
    errorTitle?: string;
    errorMessage?: string;
  }) {
    const message = await this.prisma.message.findUnique({
      where: { metaMessageId: input.metaMessageId },
    });
    if (!message) return null;

    const rank: Record<string, number> = {
      PENDING: 0,
      FAILED: 1,
      SENT: 2,
      RECEIVED: 2,
      DELIVERED: 3,
      READ: 4,
    };
    const isFailure = input.status === MessageStatus.FAILED;
    if (!isFailure && rank[input.status] <= rank[message.status]) return message;

    return this.prisma.message.update({
      where: { id: message.id },
      data: {
        status: input.status,
        errorCode: input.errorCode || null,
        errorTitle: input.errorTitle || null,
        errorMessage: input.errorMessage || null,
      },
    });
  }

  // ---------------------------------------------------------------------
  // Conversation bookkeeping
  // ---------------------------------------------------------------------

  async touchConversation(
    conversationId: string,
    opts: { preview: string; at: Date; incoming: boolean },
  ) {
    return this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        lastMessage: opts.preview.slice(0, 500),
        lastMessageAt: opts.at,
        ...(opts.incoming
          ? {
              lastInboundAt: opts.at,
              unreadCount: { increment: 1 },
              // A customer writing back reopens a closed thread.
              status: ConversationStatus.OPEN,
            }
          : {}),
      },
      include: { customer: true },
    });
  }

  async markRead(conversationId: string) {
    const conversation = await this.findConversation(conversationId);
    const updated = await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: { unreadCount: 0 },
      include: { customer: true },
    });

    // Newest inbound message, so the caller can send Meta a read receipt.
    const lastInbound = await this.prisma.message.findFirst({
      where: { conversationId, direction: MessageDirection.INCOMING },
      orderBy: { timestamp: 'desc' },
    });

    return { conversation: updated, lastInboundMetaId: lastInbound?.metaMessageId || null };
  }

  async setStatus(conversationId: string, status: ConversationStatus) {
    await this.findConversation(conversationId);
    return this.prisma.conversation.update({
      where: { id: conversationId },
      data: { status },
      include: { customer: true },
    });
  }

  async assign(conversationId: string, assignedTo: string | null) {
    await this.findConversation(conversationId);
    return this.prisma.conversation.update({
      where: { id: conversationId },
      data: { assignedTo },
      include: { customer: true },
    });
  }

  async listCustomers(search?: string) {
    const where: Prisma.CustomerWhereInput = {};
    if (search && search.trim()) {
      const q = search.trim();
      where.OR = [
        { phoneNumber: { contains: q, mode: 'insensitive' } },
        { name: { contains: q, mode: 'insensitive' } },
        { profileName: { contains: q, mode: 'insensitive' } },
      ];
    }
    return this.prisma.customer.findMany({ where, orderBy: { updatedAt: 'desc' }, take: 200 });
  }

  // ---------------------------------------------------------------------
  // Service window
  // ---------------------------------------------------------------------

  static windowState(lastInboundAt: Date | null | undefined) {
    if (!lastInboundAt) return { open: false, expiresAt: null as string | null };
    const expires = new Date(lastInboundAt.getTime() + SERVICE_WINDOW_MS);
    return { open: expires.getTime() > Date.now(), expiresAt: expires.toISOString() };
  }

  // ---------------------------------------------------------------------
  // Serialization - the exact shapes the frontend consumes
  // ---------------------------------------------------------------------

  serializeConversation(c: any) {
    const customer = c.customer || null;
    return {
      id: c.id,
      customerId: c.customerId,
      phoneNumber: c.phoneNumber,
      status: c.status,
      name: customer ? customer.name || customer.profileName || null : null,
      profileName: customer ? customer.profileName : null,
      lastMessage: c.lastMessage,
      lastMessageAt: c.lastMessageAt ? c.lastMessageAt.toISOString() : null,
      lastInboundAt: c.lastInboundAt ? c.lastInboundAt.toISOString() : null,
      unreadCount: c.unreadCount,
      assignedTo: c.assignedTo,
      createdAt: c.createdAt ? c.createdAt.toISOString() : null,
      serviceWindow: ConversationService.windowState(c.lastInboundAt),
      customer: customer
        ? {
            id: customer.id,
            phoneNumber: customer.phoneNumber,
            name: customer.name,
            profileName: customer.profileName,
            createdAt: customer.createdAt ? customer.createdAt.toISOString() : null,
          }
        : null,
    };
  }

  serializeMessage(m: any) {
    return {
      id: m.id,
      conversationId: m.conversationId,
      metaMessageId: m.metaMessageId,
      direction: m.direction,
      fromMe: m.direction === MessageDirection.OUTGOING,
      type: m.messageType,
      text: m.messageText,
      caption: m.caption,
      mediaId: m.mediaId,
      mediaMimeType: m.mediaMimeType,
      mediaFilename: m.mediaFilename,
      contextId: m.contextId,
      status: m.status,
      timestamp: m.timestamp ? m.timestamp.toISOString() : null,
      error:
        m.status === MessageStatus.FAILED
          ? { code: m.errorCode, title: m.errorTitle, message: m.errorMessage }
          : null,
      sentBy: m.sentBy,
    };
  }
}
