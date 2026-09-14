import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { MessageStatus } from '@prisma/client';
import { MetaMessagingService, MetaSendResult, ProductSection } from '../../meta/meta-messaging.service';
import { MetaTokenService } from '../../meta/meta-token.service';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsappGateway } from '../whatsapp.gateway';
import { AccountService } from './account.service';
import { ConversationService } from './conversation.service';

export interface SendContext {
  phoneNumberId: string;
  token: string;
  accountId: string;
}

/**
 * Orchestrates an outbound send: pick the sending number, enforce the 24h
 * window, call Meta, persist the result (success *or* failure), then push the
 * row to the inbox in real time.
 *
 * The persistence-on-failure part matters: a message that Meta rejected still
 * belongs in the thread, marked FAILED with the reason, so the operator can
 * see what happened rather than watching a message silently vanish.
 */
@Injectable()
export class MessagingService {
  private readonly logger = new Logger(MessagingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly meta: MetaMessagingService,
    private readonly tokens: MetaTokenService,
    private readonly accounts: AccountService,
    private readonly conversations: ConversationService,
    private readonly gateway: WhatsappGateway,
  ) {}

  /** Resolves which number and token this send uses. */
  async context(params: { accountId?: string; phoneNumberId?: string }): Promise<SendContext> {
    const number = await this.accounts.resolveSendingNumber(params);
    const token = await this.tokens.forAccount(number.whatsappAccountId);
    return {
      phoneNumberId: number.phoneNumberId,
      token,
      accountId: number.whatsappAccountId,
    };
  }

  /** Default catalog for an account, used when the caller does not name one. */
  async resolveCatalog(params: { catalogId?: string; accountId?: string }) {
    if (params.catalogId) {
      const catalog = await this.prisma.catalog.findFirst({
        where: { OR: [{ id: params.catalogId }, { metaCatalogId: params.catalogId }] },
      });
      if (!catalog) throw new NotFoundException('That catalog is not connected here.');
      return catalog;
    }

    const catalog = await this.prisma.catalog.findFirst({
      where: params.accountId ? { whatsappAccountId: params.accountId } : {},
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    if (!catalog) {
      throw new BadRequestException({
        statusCode: 400,
        message:
          'No product catalog is connected yet. Connect one from the Catalog page before sending ' +
          'products to customers.',
        code: 'CATALOG_NOT_FOUND',
      });
    }
    return catalog;
  }

  // -----------------------------------------------------------------------
  // Core dispatch
  // -----------------------------------------------------------------------

  private async dispatch(params: {
    conversationId: string;
    messageType: string;
    messageText?: string;
    sentBy?: string;
    preview?: string;
    media?: { mediaId: string; mimeType: string; filename: string; caption?: string };
    send: () => Promise<MetaSendResult>;
  }) {
    let result: MetaSendResult;

    try {
      result = await params.send();
    } catch (err) {
      // Record the attempt so the failure is visible in the thread.
      const failed = await this.conversations.recordOutgoingMessage({
        conversationId: params.conversationId,
        messageType: params.messageType,
        messageText: params.messageText,
        status: MessageStatus.FAILED,
        sentBy: params.sentBy,
        errorMessage: (err as any)?.response?.message || (err as Error).message,
        errorCode: (err as any)?.response?.code || null,
      });
      this.gateway.emitNewMessage({
        conversationId: params.conversationId,
        customer: null,
        message: this.conversations.serializeMessage(failed),
      });
      throw err;
    }

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
      preview: params.preview || params.messageText || params.messageType,
      at: stored.timestamp,
      incoming: false,
    });

    const dto = this.conversations.serializeMessage(stored);
    this.gateway.emitNewMessage({
      conversationId: params.conversationId,
      customer: this.conversations.serializeConversation(conversation).customer,
      message: dto,
    });
    this.gateway.emitConversation(this.conversations.serializeConversation(conversation));

    return dto;
  }

  /**
   * Meta rejects a free-form message outside the 24h window anyway; checking
   * first gives a clearer reason and does not burn an API call.
   */
  private async requireOpenWindow(conversationId: string) {
    const conversation = await this.conversations.findConversation(conversationId);
    const window = ConversationService.windowState(conversation.lastInboundAt);
    if (window.open) return;

    throw new BadRequestException({
      statusCode: 400,
      message:
        'The 24-hour customer service window is closed for this customer. Send an approved ' +
        'template message instead.',
      code: 'SERVICE_WINDOW_CLOSED',
      serviceWindow: window,
    });
  }

  // -----------------------------------------------------------------------
  // Public sends
  // -----------------------------------------------------------------------

  async sendText(params: {
    to: string;
    message: string;
    sentBy?: string;
    accountId?: string;
    phoneNumberId?: string;
  }) {
    const to = MetaMessagingService.normalizePhone(params.to);
    if (!to) throw new BadRequestException('A valid recipient phone number is required.');

    const ctx = await this.context(params);
    const { conversation } = await this.conversations.resolveConversationForPhone(to);
    await this.requireOpenWindow(conversation.id);

    return this.dispatch({
      conversationId: conversation.id,
      messageType: 'text',
      messageText: params.message,
      sentBy: params.sentBy,
      send: () =>
        this.meta.sendText({
          phoneNumberId: ctx.phoneNumberId,
          token: ctx.token,
          to,
          body: params.message,
        }),
    });
  }

  async sendTemplate(params: {
    to: string;
    templateName: string;
    language?: string;
    components?: unknown[];
    sentBy?: string;
    accountId?: string;
    phoneNumberId?: string;
  }) {
    const to = MetaMessagingService.normalizePhone(params.to);
    if (!to) throw new BadRequestException('A valid recipient phone number is required.');

    const ctx = await this.context(params);
    const { conversation } = await this.conversations.resolveConversationForPhone(to);

    return this.dispatch({
      conversationId: conversation.id,
      messageType: 'template',
      messageText: `Template: ${params.templateName}`,
      sentBy: params.sentBy,
      send: () =>
        this.meta.sendTemplate({
          phoneNumberId: ctx.phoneNumberId,
          token: ctx.token,
          to,
          templateName: params.templateName,
          language: params.language,
          components: params.components,
        }),
    });
  }

  async sendMedia(params: {
    to: string;
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number };
    caption?: string;
    sentBy?: string;
    accountId?: string;
    phoneNumberId?: string;
  }) {
    const to = MetaMessagingService.normalizePhone(params.to);
    if (!to) throw new BadRequestException('A valid recipient phone number is required.');

    const type = MessagingService.mediaTypeFor(params.file.mimetype);
    const ctx = await this.context(params);
    const { conversation } = await this.conversations.resolveConversationForPhone(to);
    await this.requireOpenWindow(conversation.id);

    const mediaId = await this.meta.uploadMedia({
      phoneNumberId: ctx.phoneNumberId,
      token: ctx.token,
      file: params.file,
    });

    return this.dispatch({
      conversationId: conversation.id,
      messageType: type,
      messageText: params.caption,
      preview: params.caption || type,
      sentBy: params.sentBy,
      media: {
        mediaId,
        mimeType: params.file.mimetype,
        filename: params.file.originalname,
        caption: params.caption,
      },
      send: () =>
        this.meta.sendMedia({
          phoneNumberId: ctx.phoneNumberId,
          token: ctx.token,
          to,
          type: type as any,
          mediaId,
          caption: params.caption,
          filename: params.file.originalname,
        }),
    });
  }

  static mediaTypeFor(mimeType: string): string {
    if (mimeType.startsWith('image/')) return mimeType === 'image/webp' ? 'sticker' : 'image';
    if (mimeType.startsWith('video/')) return 'video';
    if (mimeType.startsWith('audio/')) return 'audio';
    return 'document';
  }

  // -----------------------------------------------------------------------
  // Catalog sends
  // -----------------------------------------------------------------------

  /**
   * Single Product Message. `includeMedia` optionally sends the product's own
   * photos first, which is what most sellers actually want: the pictures, then
   * the tappable product card.
   */
  async sendProduct(params: {
    to: string;
    productId?: string;
    productRetailerId?: string;
    catalogId?: string;
    body?: string;
    footer?: string;
    includeMedia?: boolean;
    sentBy?: string;
    accountId?: string;
    phoneNumberId?: string;
  }) {
    const to = MetaMessagingService.normalizePhone(params.to);
    if (!to) throw new BadRequestException('A valid recipient phone number is required.');

    const product = await this.resolveProduct(params);
    const catalog = await this.prisma.catalog.findUnique({ where: { id: product.catalogId } });
    if (!catalog) throw new NotFoundException('That product is not in a connected catalog.');

    const ctx = await this.context({
      accountId: params.accountId || catalog.whatsappAccountId,
      phoneNumberId: params.phoneNumberId,
    });
    const { conversation } = await this.conversations.resolveConversationForPhone(to);
    await this.requireOpenWindow(conversation.id);

    if (params.includeMedia) {
      await this.sendProductMedia({ ctx, to, productId: product.id, sentBy: params.sentBy });
    }

    return this.dispatch({
      conversationId: conversation.id,
      messageType: 'interactive_product',
      messageText: params.body || product.name,
      preview: `Product: ${product.name}`,
      sentBy: params.sentBy,
      send: () =>
        this.meta.sendProduct({
          phoneNumberId: ctx.phoneNumberId,
          token: ctx.token,
          to,
          catalogId: catalog.metaCatalogId,
          productRetailerId: product.retailerId,
          bodyText: params.body,
          footerText: params.footer,
        }),
    });
  }

  private async resolveProduct(params: { productId?: string; productRetailerId?: string; catalogId?: string }) {
    if (params.productId) {
      const product = await this.prisma.product.findUnique({ where: { id: params.productId } });
      if (!product) throw new NotFoundException('Product not found.');
      return product;
    }

    if (!params.productRetailerId) {
      throw new BadRequestException('Either productId or product_retailer_id is required.');
    }

    const product = await this.prisma.product.findFirst({
      where: {
        retailerId: params.productRetailerId,
        deletedAt: null,
        ...(params.catalogId
          ? { catalog: { OR: [{ id: params.catalogId }, { metaCatalogId: params.catalogId }] } }
          : {}),
      },
    });
    if (!product) {
      throw new NotFoundException(
        `No product with SKU "${params.productRetailerId}" exists in a connected catalog.`,
      );
    }
    return product;
  }

  /**
   * Sends a product's images and videos as ordinary WhatsApp media.
   *
   * These go out by public link rather than an upload, so no bytes leave this
   * server twice - Meta fetches them from the same URL the catalog uses.
   */
  private async sendProductMedia(params: {
    ctx: SendContext;
    to: string;
    productId: string;
    sentBy?: string;
  }) {
    const media = await this.prisma.productMedia.findMany({
      where: { productId: params.productId },
      orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
      take: 5,
    });

    for (const item of media) {
      try {
        await this.meta.sendMedia({
          phoneNumberId: params.ctx.phoneNumberId,
          token: params.ctx.token,
          to: params.to,
          type: item.kind === 'VIDEO' ? 'video' : 'image',
          link: item.url,
        });
      } catch (err) {
        // One unreachable image should not stop the product card from going out.
        this.logger.warn(`Could not send product media ${item.id}: ${(err as Error).message}`);
      }
    }
  }

  /** Multi-Product Message, from explicit sections or a whole collection. */
  async sendProductList(params: {
    to: string;
    catalogId?: string;
    collectionId?: string;
    header: string;
    body: string;
    footer?: string;
    sections?: ProductSection[];
    sentBy?: string;
    accountId?: string;
    phoneNumberId?: string;
  }) {
    const to = MetaMessagingService.normalizePhone(params.to);
    if (!to) throw new BadRequestException('A valid recipient phone number is required.');

    let sections = params.sections;
    let catalogId = params.catalogId;

    if (params.collectionId) {
      const collection = await this.prisma.collection.findUnique({
        where: { id: params.collectionId },
        include: {
          catalog: true,
          products: {
            include: { product: true },
            orderBy: { sortOrder: 'asc' },
            take: 30,
          },
        },
      });
      if (!collection) throw new NotFoundException('Collection not found.');

      const retailerIds = collection.products
        .filter((row) => row.product && !row.product.deletedAt && row.product.metaProductId)
        .map((row) => row.product.retailerId);

      if (!retailerIds.length) {
        throw new BadRequestException(
          'This collection has no published products yet. Publish its products before sending it.',
        );
      }

      sections = [{ title: collection.name.slice(0, 24), productRetailerIds: retailerIds }];
      catalogId = collection.catalog.id;
    }

    if (!sections?.length) {
      throw new BadRequestException('Provide either sections or a collectionId.');
    }

    const catalog = await this.resolveCatalog({ catalogId, accountId: params.accountId });
    const ctx = await this.context({
      accountId: params.accountId || catalog.whatsappAccountId,
      phoneNumberId: params.phoneNumberId,
    });
    const { conversation } = await this.conversations.resolveConversationForPhone(to);
    await this.requireOpenWindow(conversation.id);

    const count = sections.reduce((sum, s) => sum + s.productRetailerIds.length, 0);

    return this.dispatch({
      conversationId: conversation.id,
      messageType: 'interactive_product_list',
      messageText: params.body,
      preview: `Sent ${count} products`,
      sentBy: params.sentBy,
      send: () =>
        this.meta.sendProductList({
          phoneNumberId: ctx.phoneNumberId,
          token: ctx.token,
          to,
          catalogId: catalog.metaCatalogId,
          headerText: params.header,
          bodyText: params.body,
          footerText: params.footer,
          sections,
        }),
    });
  }

  /** Catalog Message - opens the whole catalog in WhatsApp. */
  async sendCatalog(params: {
    to: string;
    catalogId?: string;
    body: string;
    footer?: string;
    thumbnailProductRetailerId?: string;
    sentBy?: string;
    accountId?: string;
    phoneNumberId?: string;
  }) {
    const to = MetaMessagingService.normalizePhone(params.to);
    if (!to) throw new BadRequestException('A valid recipient phone number is required.');

    const catalog = await this.resolveCatalog(params);
    const ctx = await this.context({
      accountId: params.accountId || catalog.whatsappAccountId,
      phoneNumberId: params.phoneNumberId,
    });
    const { conversation } = await this.conversations.resolveConversationForPhone(to);
    await this.requireOpenWindow(conversation.id);

    return this.dispatch({
      conversationId: conversation.id,
      messageType: 'interactive_catalog',
      messageText: params.body,
      preview: 'Sent the catalog',
      sentBy: params.sentBy,
      send: () =>
        this.meta.sendCatalog({
          phoneNumberId: ctx.phoneNumberId,
          token: ctx.token,
          to,
          bodyText: params.body,
          footerText: params.footer,
          thumbnailProductRetailerId: params.thumbnailProductRetailerId,
        }),
    });
  }

  // -----------------------------------------------------------------------
  // Read receipts
  // -----------------------------------------------------------------------

  async markConversationRead(conversationId: string) {
    const { conversation, lastInboundMetaId } = await this.conversations.markRead(conversationId);

    if (lastInboundMetaId) {
      try {
        const ctx = await this.context({});
        await this.meta.markRead({
          phoneNumberId: ctx.phoneNumberId,
          token: ctx.token,
          metaMessageId: lastInboundMetaId,
        });
      } catch (err) {
        // Blue ticks are cosmetic; never fail marking a thread read locally.
        this.logger.debug(`Read receipt skipped: ${(err as Error).message}`);
      }
    }

    const dto = this.conversations.serializeConversation(conversation);
    this.gateway.emitConversation(dto);
    return dto;
  }
}
