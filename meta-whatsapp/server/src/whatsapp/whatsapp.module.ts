import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ConversationService } from './services/conversation.service';
import { MessagingService } from './services/messaging.service';
import { WebhookService } from './services/webhook.service';
import { WhatsappService } from './services/whatsapp.service';
import { WebhookController } from './webhook.controller';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappGateway } from './whatsapp.gateway';

@Module({
  imports: [AuthModule],
  controllers: [WebhookController, WhatsappController],
  providers: [
    WhatsappService,
    ConversationService,
    MessagingService,
    WebhookService,
    WhatsappGateway,
  ],
  exports: [WhatsappService, ConversationService],
})
export class WhatsappModule {}
