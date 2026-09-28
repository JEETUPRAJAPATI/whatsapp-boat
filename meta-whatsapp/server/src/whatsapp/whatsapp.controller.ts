import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { ConversationStatus } from '@prisma/client';
import { Response } from 'express';
import {
  ListConversationsDto,
  ListMessagesDto,
  UpdateConversationDto,
} from './dto/conversation-query.dto';
import { SendMediaDto, SendMessageDto } from './dto/send-message.dto';
import { SendTemplateDto } from './dto/send-template.dto';
import { ConversationService } from './services/conversation.service';
import { MessagingService } from './services/messaging.service';
import { WhatsappService } from './services/whatsapp.service';

/**
 * Admin inbox API. No authentication gate - anyone who can reach this
 * server can read conversations and send WhatsApp messages.
 */
@Controller('api/whatsapp')
export class WhatsappController {
  constructor(
    private readonly conversations: ConversationService,
    private readonly messaging: MessagingService,
    private readonly whatsapp: WhatsappService,
  ) {}

  /** Config health for the UI banner - contains no secrets. */
  @Get('status')
  status() {
    return this.whatsapp.publicConfig;
  }

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

  /** Free-form text - only valid inside the 24h customer service window. */
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @HttpCode(200)
  @Post('send-message')
  sendMessage(@Body() dto: SendMessageDto) {
    return this.messaging.sendText({
      to: dto.to,
      message: dto.message,
    });
  }

  /** Approved template - works whether or not the window is open. */
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(200)
  @Post('send-template')
  sendTemplate(@Body() dto: SendTemplateDto) {
    return this.messaging.sendTemplate({
      to: dto.to,
      templateName: dto.template_name,
      language: dto.language,
      components: dto.components,
    });
  }

  /**
   * Image / video / audio / document send. The file is uploaded to Meta and
   * forwarded in one request; nothing is written to disk on our side.
   */
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(200)
  @Post('send-media')
  @UseInterceptors(
    FileInterceptor('file', {
      // Documents may be up to 100 MB; per-type limits are enforced in the service.
      limits: { fileSize: 100 * 1024 * 1024, files: 1 },
    }),
  )
  sendMedia(@UploadedFile() file: Express.Multer.File, @Body() dto: SendMediaDto) {
    if (!file) throw new BadRequestException('A file is required');
    return this.messaging.sendMedia({
      to: dto.to,
      file,
      caption: dto.caption,
    });
  }

  /**
   * Streams a message's media through the server. Meta's own media URLs need
   * the access token, which must never reach the browser - so we proxy it.
   */
  @Get('messages/:id/media')
  async getMedia(@Param('id') id: string, @Res() res: Response) {
    const message = await this.conversations.findMessage(id);
    if (!message.mediaId) throw new NotFoundException('This message has no media');

    const resolved = await this.whatsapp.getMediaUrl(message.mediaId);
    if (!resolved || !resolved.url) {
      throw new NotFoundException('Media is no longer available from WhatsApp');
    }

    const { buffer, contentType } = await this.whatsapp.downloadMedia(resolved.url);
    const filename = message.mediaFilename || `${message.messageType}-${message.id}`;

    res.setHeader('Content-Type', message.mediaMimeType || contentType);
    res.setHeader('Content-Length', String(buffer.length));
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('Content-Disposition', `inline; filename="${filename.replace(/"/g, '')}"`);
    res.end(buffer);
  }

  @Get('customers')
  listCustomers(@Query('search') search?: string) {
    return this.conversations.listCustomers(search);
  }
}
