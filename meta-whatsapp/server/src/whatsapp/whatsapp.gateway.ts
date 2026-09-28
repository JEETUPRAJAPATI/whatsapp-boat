import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

/**
 * Real-time bridge to the admin inbox.
 *
 * Events emitted:
 *   whatsapp:new-message    { conversationId, customer, message }
 *   whatsapp:message-status { conversationId, metaMessageId, status, error }
 *   whatsapp:conversation   { conversation }  - list row changed
 */
@WebSocketGateway({
  cors: { origin: true, credentials: true },
  path: '/socket.io',
})
export class WhatsappGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger('WhatsApp Gateway');

  @WebSocketServer()
  server: Server;

  /** No auth gate - every socket that connects joins the inbox room. */
  handleConnection(client: Socket) {
    client.join('inbox');
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  /** Lets a client scope itself to one open conversation (optional). */
  @SubscribeMessage('whatsapp:join-conversation')
  joinConversation(client: Socket, conversationId: string) {
    if (conversationId) client.join(`conversation:${conversationId}`);
  }

  emitNewMessage(payload: { conversationId: string; customer: unknown; message: unknown }) {
    this.server?.to('inbox').emit('whatsapp:new-message', payload);
  }

  emitMessageStatus(payload: {
    conversationId: string;
    metaMessageId: string;
    status: string;
    error?: unknown;
  }) {
    this.server?.to('inbox').emit('whatsapp:message-status', payload);
  }

  emitConversation(conversation: unknown) {
    this.server?.to('inbox').emit('whatsapp:conversation', { conversation });
  }
}
