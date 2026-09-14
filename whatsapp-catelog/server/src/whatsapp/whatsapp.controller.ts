import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { ConversationStatus } from '@prisma/client';
import { Response } from 'express';
import { AuditService } from '../audit/audit.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { MetaMessagingService } from '../meta/meta-messaging.service';
import { MetaTokenService } from '../meta/meta-token.service';
import {
  CommerceSettingsDto,
  ConnectAccountDto,
  EmbeddedSignupDto,
  RegisterNumberDto,
  RequestCodeDto,
  VerifyCodeDto,
} from './dto/connect.dto';
import {
  ListConversationsDto,
  ListMessagesDto,
  SendCatalogDto,
  SendMediaDto,
  SendMessageDto,
  SendProductDto,
  SendProductListDto,
  SendTemplateDto,
  UpdateConversationDto,
} from './dto/send.dto';
import { AccountService } from './services/account.service';
import { ConversationService } from './services/conversation.service';
import { EmbeddedSignupService } from './services/embedded-signup.service';
import { MessagingService } from './services/messaging.service';

type AdminUser = { email: string };

/**
 * Admin WhatsApp API.
 *
 * Every route requires a valid admin JWT: an unauthenticated caller can never
 * read a conversation, change a connection, or send a message. The Meta access
 * token is never a parameter here and never appears in a response.
 */
@UseGuards(JwtAuthGuard)
@Controller('api/whatsapp')
export class WhatsappController {
  constructor(
    private readonly accounts: AccountService,
    private readonly signup: EmbeddedSignupService,
    private readonly messaging: MessagingService,
    private readonly conversations: ConversationService,
    private readonly meta: MetaMessagingService,
    private readonly tokens: MetaTokenService,
    private readonly audit: AuditService,
  ) {}

  // =======================================================================
  // Connection status and accounts
  // =======================================================================

  @Get('status')
  status() {
    return this.accounts.connectionStatus();
  }

  @Get('accounts')
  listAccounts() {
    return this.accounts.listAccounts();
  }

  @Get('accounts/:id')
  getAccount(@Param('id') id: string) {
    return this.accounts.findAccount(id);
  }

  /** Credential metadata for the settings screen - never the token itself. */
  @Get('accounts/:id/credential')
  credential(@Param('id') id: string) {
    return this.tokens.describe(id);
  }

  @HttpCode(200)
  @Post('accounts/:id/refresh')
  async refresh(@Param('id') id: string, @CurrentUser() user: AdminUser) {
    const account = await this.accounts.refresh(id);
    await this.audit.log({
      userEmail: user?.email,
      action: 'whatsapp.refreshed',
      entity: 'whatsapp_account',
      entityId: id,
    });
    return account;
  }

  @Delete('accounts/:id')
  async disconnect(@Param('id') id: string, @CurrentUser() user: AdminUser) {
    const result = await this.accounts.disconnect(id);
    await this.audit.log({
      userEmail: user?.email,
      action: 'whatsapp.disconnected',
      entity: 'whatsapp_account',
      entityId: id,
    });
    return result;
  }

  // =======================================================================
  // Onboarding
  // =======================================================================

  /** Public config the frontend needs to open Meta's own signup window. */
  @Get('embedded-signup/config')
  embeddedSignupConfig() {
    return this.signup.publicConfig();
  }

  /**
   * Exchanges the Embedded Signup code for a token, server-side.
   * The browser sends a code; it never sees a token.
   */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('embedded-signup')
  async embeddedSignup(@Body() dto: EmbeddedSignupDto, @CurrentUser() user: AdminUser) {
    try {
      const result = await this.signup.complete({
        code: dto.code,
        wabaId: dto.waba_id,
        phoneNumberId: dto.phone_number_id,
        businessId: dto.business_id,
      });
      await this.audit.log({
        userEmail: user?.email,
        action: 'whatsapp.connected',
        entity: 'whatsapp_account',
        entityId: result.account.id,
        message: `Connected WABA ${result.account.wabaId} via Embedded Signup`,
      });
      return result;
    } catch (err) {
      await this.audit.logFailure(
        { userEmail: user?.email, action: 'whatsapp.connect_failed', entity: 'whatsapp_account' },
        err,
      );
      throw err;
    }
  }

  /** Discovery endpoints backing the manual (System User token) setup path. */
  @Get('discover/businesses')
  discoverBusinesses() {
    return this.accounts.discoverBusinesses();
  }

  @Get('discover/accounts')
  discoverWabas(@Query('businessId') businessId?: string) {
    return this.accounts.discoverWabas(businessId);
  }

  @Get('discover/phone-numbers')
  discoverPhoneNumbers(@Query('wabaId') wabaId: string) {
    if (!wabaId) throw new BadRequestException('wabaId is required.');
    return this.accounts.discoverPhoneNumbers(wabaId);
  }

  @HttpCode(200)
  @Post('connect')
  async connect(@Body() dto: ConnectAccountDto, @CurrentUser() user: AdminUser) {
    try {
      const account = await this.accounts.connectManually(dto);
      await this.audit.log({
        userEmail: user?.email,
        action: 'whatsapp.connected',
        entity: 'whatsapp_account',
        entityId: account.id,
        message: `Connected WABA ${dto.wabaId} with the server access token`,
      });
      return account;
    } catch (err) {
      await this.audit.logFailure(
        { userEmail: user?.email, action: 'whatsapp.connect_failed', entity: 'whatsapp_account' },
        err,
      );
      throw err;
    }
  }

  // =======================================================================
  // Phone number onboarding
  // =======================================================================

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('accounts/:id/request-code')
  requestCode(@Param('id') id: string, @Body() dto: RequestCodeDto) {
    return this.accounts.requestVerificationCode(id, dto.phoneNumberId, dto.codeMethod || 'SMS');
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('accounts/:id/verify-code')
  verifyCode(@Param('id') id: string, @Body() dto: VerifyCodeDto) {
    return this.accounts.verifyCode(id, dto.phoneNumberId, dto.code);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('accounts/:id/register-number')
  async registerNumber(
    @Param('id') id: string,
    @Body() dto: RegisterNumberDto,
    @CurrentUser() user: AdminUser,
  ) {
    const result = await this.signup.registerNumber({
      accountId: id,
      phoneNumberId: dto.phoneNumberId,
      pin: dto.pin,
    });
    await this.audit.log({
      userEmail: user?.email,
      action: 'whatsapp.number_registered',
      entity: 'whatsapp_phone_number',
      entityId: dto.phoneNumberId,
    });
    return result;
  }

  /** Controls whether the catalog is visible inside the WhatsApp chat. */
  @HttpCode(200)
  @Post('accounts/:id/commerce-settings')
  commerceSettings(@Param('id') id: string, @Body() dto: CommerceSettingsDto) {
    return this.accounts.setCommerceSettings(id, dto.phoneNumberId, {
      isCatalogVisible: dto.isCatalogVisible,
      isCartEnabled: dto.isCartEnabled,
    });
  }

  // =======================================================================
  // Inbox
  // =======================================================================

  @Get('conversations')
  listConversations(@Query() query: ListConversationsDto) {
    return this.conversations.listConversations({
      search: query.search,
      status: query.status as ConversationStatus,
    });
  }

  @Get('conversations/:id')
  async getConversation(@Param('id') id: string) {
    const conversation = await this.conversations.findConversation(id);
    return this.conversations.serializeConversation(conversation);
  }

  @Get('conversations/:id/messages')
  listMessages(@Param('id') id: string, @Query() query: ListMessagesDto) {
    return this.conversations.listMessages(id, { limit: query.limit, before: query.before });
  }

  @HttpCode(200)
  @Post('conversations/:id/read')
  markRead(@Param('id') id: string) {
    return this.messaging.markConversationRead(id);
  }

  @Patch('conversations/:id')
  async updateConversation(@Param('id') id: string, @Body() dto: UpdateConversationDto) {
    let conversation;
    if (dto.status) {
      conversation = await this.conversations.setStatus(id, dto.status as ConversationStatus);
    }
    if (dto.assignedTo !== undefined) {
      conversation = await this.conversations.assign(id, dto.assignedTo || null);
    }
    if (!conversation) conversation = await this.conversations.findConversation(id);
    return this.conversations.serializeConversation(conversation);
  }

  @Get('customers')
  listCustomers(@Query('search') search?: string) {
    return this.conversations.listCustomers(search);
  }

  // =======================================================================
  // Sending
  // =======================================================================

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @HttpCode(200)
  @Post('send-message')
  sendMessage(@Body() dto: SendMessageDto, @CurrentUser() user: AdminUser) {
    return this.messaging.sendText({
      to: dto.to,
      message: dto.message,
      sentBy: user?.email,
      accountId: dto.accountId,
      phoneNumberId: dto.phoneNumberId,
    });
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(200)
  @Post('send-template')
  sendTemplate(@Body() dto: SendTemplateDto, @CurrentUser() user: AdminUser) {
    return this.messaging.sendTemplate({
      to: dto.to,
      templateName: dto.template_name,
      language: dto.language,
      components: dto.components,
      sentBy: user?.email,
      accountId: dto.accountId,
      phoneNumberId: dto.phoneNumberId,
    });
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(200)
  @Post('send-media')
  @UseInterceptors(
    FileInterceptor('file', {
      // Documents may be up to 100 MB; per-type limits are enforced downstream.
      limits: { fileSize: 100 * 1024 * 1024, files: 1 },
    }),
  )
  sendMedia(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: SendMediaDto,
    @CurrentUser() user: AdminUser,
  ) {
    if (!file) throw new BadRequestException('A file is required.');
    return this.messaging.sendMedia({
      to: dto.to,
      file,
      caption: dto.caption,
      sentBy: user?.email,
      accountId: dto.accountId,
      phoneNumberId: dto.phoneNumberId,
    });
  }

  /** Single Product Message. */
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(200)
  @Post('send-product')
  async sendProduct(@Body() dto: SendProductDto, @CurrentUser() user: AdminUser) {
    const message = await this.messaging.sendProduct({
      to: dto.to,
      productId: dto.productId,
      productRetailerId: dto.product_retailer_id,
      catalogId: dto.catalogId,
      body: dto.body,
      footer: dto.footer,
      includeMedia: dto.includeMedia,
      sentBy: user?.email,
      accountId: dto.accountId,
      phoneNumberId: dto.phoneNumberId,
    });
    await this.audit.log({
      userEmail: user?.email,
      action: 'whatsapp.product_sent',
      entity: 'product',
      entityId: dto.productId || dto.product_retailer_id,
    });
    return message;
  }

  /** Multi-Product Message, from sections or a collection. */
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(200)
  @Post('send-product-list')
  async sendProductList(@Body() dto: SendProductListDto, @CurrentUser() user: AdminUser) {
    const message = await this.messaging.sendProductList({
      to: dto.to,
      catalogId: dto.catalogId,
      collectionId: dto.collectionId,
      header: dto.header,
      body: dto.body,
      footer: dto.footer,
      sections: dto.sections?.map((s) => ({
        title: s.title,
        productRetailerIds: s.product_retailer_ids,
      })),
      sentBy: user?.email,
      accountId: dto.accountId,
      phoneNumberId: dto.phoneNumberId,
    });
    await this.audit.log({
      userEmail: user?.email,
      action: 'whatsapp.product_list_sent',
      entity: 'collection',
      entityId: dto.collectionId || null,
    });
    return message;
  }

  /** Catalog Message - opens the whole catalog in WhatsApp. */
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(200)
  @Post('send-catalog')
  async sendCatalog(@Body() dto: SendCatalogDto, @CurrentUser() user: AdminUser) {
    const message = await this.messaging.sendCatalog({
      to: dto.to,
      catalogId: dto.catalogId,
      body: dto.body,
      footer: dto.footer,
      thumbnailProductRetailerId: dto.thumbnail_product_retailer_id,
      sentBy: user?.email,
      accountId: dto.accountId,
      phoneNumberId: dto.phoneNumberId,
    });
    await this.audit.log({
      userEmail: user?.email,
      action: 'whatsapp.catalog_sent',
      entity: 'catalog',
      entityId: dto.catalogId || null,
    });
    return message;
  }

  // =======================================================================
  // Media proxy
  // =======================================================================

  /**
   * Streams a message's media through the server.
   *
   * Meta's own media URLs require the access token, which must never reach the
   * browser - so we fetch the bytes here and hand back only the bytes.
   */
  @Get('messages/:id/media')
  async getMedia(@Param('id') id: string, @Res() res: Response) {
    const message = await this.conversations.findMessage(id);
    if (!message.mediaId) throw new NotFoundException('This message has no media.');

    const ctx = await this.messaging.context({});

    const resolved = await this.meta.getMediaUrl(ctx.token, message.mediaId);
    if (!resolved?.url) {
      throw new NotFoundException('This media is no longer available from WhatsApp.');
    }

    const { buffer, contentType } = await this.meta.downloadMedia(resolved.url, ctx.token);
    const filename = message.mediaFilename || `${message.messageType}-${message.id}`;

    res.setHeader('Content-Type', message.mediaMimeType || contentType);
    res.setHeader('Content-Length', String(buffer.length));
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('Content-Disposition', `inline; filename="${filename.replace(/"/g, '')}"`);
    res.end(buffer);
  }
}
