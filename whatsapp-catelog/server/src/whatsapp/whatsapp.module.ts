import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AccountService } from './services/account.service';
import { AutoReplyService } from './services/auto-reply.service';
import { ConversationService } from './services/conversation.service';
import { EmbeddedSignupService } from './services/embedded-signup.service';
import { MessagingService } from './services/messaging.service';
import { WebhookService } from './services/webhook.service';
import { WebhookController } from './webhook.controller';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappGateway } from './whatsapp.gateway';

@Module({
  imports: [AuthModule],
  controllers: [WebhookController, WhatsappController],
  providers: [
    AccountService,
    EmbeddedSignupService,
    ConversationService,
    MessagingService,
    AutoReplyService,
    WebhookService,
    WhatsappGateway,
  ],
  // Catalog and automation both need to resolve accounts and send messages.
  exports: [AccountService, ConversationService, MessagingService, AutoReplyService],
})
export class WhatsappModule {}
