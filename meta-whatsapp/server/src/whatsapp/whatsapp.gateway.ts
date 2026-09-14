import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { AuthService } from '../auth/auth.service';

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

  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  /** Only authenticated admins may open a socket (unless auth is disabled). */
  async handleConnection(client: Socket) {
    if (!this.config.get<boolean>('authEnabled')) {
      client.data.user = { id: 'local-admin', email: 'admin@local' };
      client.join('inbox');
      return;
    }

    const token =
      (client.handshake.auth && (client.handshake.auth as any).token) ||
      (client.handshake.query && (client.handshake.query.token as string));

    if (!token) {
      client.emit('unauthorized', { message: 'Missing token' });
      client.disconnect(true);
      return;
    }

    try {
      const payload = await this.auth.verifyToken(token);
      client.data.user = { id: payload.sub, email: payload.email };
      client.join('inbox');
      this.logger.log(`Admin connected: ${payload.email}`);
    } catch {
      client.emit('unauthorized', { message: 'Invalid token' });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    if (client.data && client.data.user) {
      this.logger.log(`Admin disconnected: ${client.data.user.email}`);
    }
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
