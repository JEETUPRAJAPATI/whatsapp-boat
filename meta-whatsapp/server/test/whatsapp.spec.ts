import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MessageStatus } from '@prisma/client';
import { MetaSettingsService } from '../src/config/meta-settings.service';
import { ConversationService } from '../src/whatsapp/services/conversation.service';
import { WebhookService } from '../src/whatsapp/services/webhook.service';
import { WhatsappService } from '../src/whatsapp/services/whatsapp.service';
import { WebhookController } from '../src/whatsapp/webhook.controller';

const META_CONFIG = {
  accessToken: 'test-token',
  phoneNumberId: '914098718459659',
  businessAccountId: '1936192610625973',
  apiVersion: 'v25.0',
  verifyToken: 'correct-verify-token',
  appSecret: '',
};

function configFor(overrides: Record<string, unknown> = {}): ConfigService {
  const values: Record<string, unknown> = { meta: META_CONFIG, webhookLogging: false, ...overrides };
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

/** Stand-in for the DB-backed settings service: WhatsappService only calls getSettings(). */
function metaSettingsFor(overrides: Record<string, unknown> = {}): MetaSettingsService {
  const settings = { ...META_CONFIG, ...overrides };
  return { getSettings: () => settings } as unknown as MetaSettingsService;
}

function inboundPayload(id = 'wamid.ABC123', body = 'Hello there') {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '1936192610625973',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '15550001111', phone_number_id: '914098718459659' },
              contacts: [{ profile: { name: 'Riya Sharma' }, wa_id: '919812345678' }],
              messages: [
                {
                  from: '919812345678',
                  id,
                  timestamp: '1788960000',
                  type: 'text',
                  text: { body },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

describe('WhatsappService', () => {
  const service = new WhatsappService(metaSettingsFor());

  describe('verifyWebhook', () => {
    it('returns the challenge when mode and verify token match', () => {
      expect(service.verifyWebhook('subscribe', 'correct-verify-token', '31337')).toBe('31337');
    });

    it('rejects a wrong verify token', () => {
      expect(service.verifyWebhook('subscribe', 'wrong-token', '31337')).toBeNull();
    });

    it('rejects a wrong hub.mode', () => {
      expect(service.verifyWebhook('unsubscribe', 'correct-verify-token', '31337')).toBeNull();
    });
  });

  describe('verifySignature', () => {
    it('accepts a correct HMAC when an app secret is configured', () => {
      const secret = 'app-secret';
      const signed = new WhatsappService(metaSettingsFor({ appSecret: secret }));
      const body = Buffer.from(JSON.stringify({ hello: 'world' }));
      const crypto = require('crypto');
      const digest = crypto.createHmac('sha256', secret).update(body).digest('hex');

      expect(signed.verifySignature(body, `sha256=${digest}`)).toBe(true);
      expect(signed.verifySignature(body, 'sha256=deadbeef')).toBe(false);
      expect(signed.verifySignature(body, undefined)).toBe(false);
    });

    it('skips the check when no app secret is set', () => {
      expect(service.verifySignature(Buffer.from('{}'), undefined)).toBe(true);
    });
  });

  it('normalizes phone numbers to digits only', () => {
    expect(WhatsappService.normalizePhone('+91 98123-45678')).toBe('919812345678');
  });
});

describe('WebhookController', () => {
  const whatsapp = new WhatsappService(metaSettingsFor());
  const webhook = { processWebhook: jest.fn().mockResolvedValue({ processed: 1 }) };
  const controller = new WebhookController(whatsapp, webhook as unknown as WebhookService);

  it('echoes the challenge on a valid handshake', () => {
    expect(controller.verify('subscribe', 'correct-verify-token', 'CHALLENGE')).toBe('CHALLENGE');
  });

  it('throws 403 on an invalid verify token', () => {
    expect(() => controller.verify('subscribe', 'nope', 'CHALLENGE')).toThrow(ForbiddenException);
  });

  it('answers 200 even when processing throws, so Meta does not disable the webhook', async () => {
    webhook.processWebhook.mockRejectedValueOnce(new Error('database down'));
    const req = { headers: {}, rawBody: Buffer.from('{}') } as any;
    await expect(controller.receive(req, {})).resolves.toEqual({ status: 'ok' });
  });
});

describe('WebhookService', () => {
  let prisma: any;
  let conversations: ConversationService;
  let gateway: any;
  let service: WebhookService;
  let stored: any[];

  beforeEach(() => {
    stored = [];
    const customer = {
      id: 'cust-1',
      phoneNumber: '919812345678',
      profileName: 'Riya Sharma',
      name: null,
      createdAt: new Date(),
    };
    const conversation = {
      id: 'conv-1',
      customerId: 'cust-1',
      phoneNumber: '919812345678',
      status: 'OPEN',
      unreadCount: 0,
      lastInboundAt: null,
      customer,
    };

    prisma = {
      customer: { upsert: jest.fn().mockResolvedValue(customer) },
      conversation: {
        findFirst: jest.fn().mockResolvedValue(conversation),
        create: jest.fn().mockResolvedValue(conversation),
        update: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            ...conversation,
            lastMessage: data.lastMessage,
            lastMessageAt: data.lastMessageAt,
            lastInboundAt: data.lastInboundAt || conversation.lastInboundAt,
            unreadCount: conversation.unreadCount + 1,
          }),
        ),
      },
      message: {
        findUnique: jest.fn().mockImplementation(({ where }) =>
          Promise.resolve(stored.find((m) => m.metaMessageId === where.metaMessageId) || null),
        ),
        create: jest.fn().mockImplementation(({ data }) => {
          const row = { id: `msg-${stored.length + 1}`, ...data };
          stored.push(row);
          return Promise.resolve(row);
        }),
        update: jest.fn().mockImplementation(({ where, data }) => {
          const row = stored.find((m) => m.id === where.id);
          Object.assign(row, data);
          return Promise.resolve(row);
        }),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      webhookLog: { create: jest.fn() },
    };

    conversations = new ConversationService(prisma);
    gateway = {
      emitNewMessage: jest.fn(),
      emitMessageStatus: jest.fn(),
      emitConversation: jest.fn(),
    };
    service = new WebhookService(prisma, conversations, gateway, configFor());
  });

  it('stores an incoming text message and notifies the inbox', async () => {
    const result = await service.processWebhook(inboundPayload());

    expect(result.processed).toBe(1);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      metaMessageId: 'wamid.ABC123',
      direction: 'INCOMING',
      messageType: 'text',
      messageText: 'Hello there',
      status: MessageStatus.RECEIVED,
    });
    expect(gateway.emitNewMessage).toHaveBeenCalledTimes(1);
  });

  it('creates the customer and the conversation on first contact', async () => {
    await service.processWebhook(inboundPayload());

    expect(prisma.customer.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { phoneNumber: '919812345678' } }),
    );
    expect(prisma.conversation.findFirst).toHaveBeenCalled();
  });

  it('increments the unread count and opens the service window', async () => {
    await service.processWebhook(inboundPayload());

    const update = prisma.conversation.update.mock.calls[0][0];
    expect(update.data.unreadCount).toEqual({ increment: 1 });
    expect(update.data.lastInboundAt).toBeInstanceOf(Date);
    expect(update.data.lastMessage).toBe('Hello there');
  });

  it('ignores a duplicate webhook delivery (idempotency)', async () => {
    await service.processWebhook(inboundPayload());
    const second = await service.processWebhook(inboundPayload());

    expect(second.processed).toBe(0);
    expect(stored).toHaveLength(1);
    expect(gateway.emitNewMessage).toHaveBeenCalledTimes(1);
  });

  it('parses an image message into media fields', async () => {
    const payload = inboundPayload();
    payload.entry[0].changes[0].value.messages[0] = {
      from: '919812345678',
      id: 'wamid.IMG1',
      timestamp: '1788960000',
      type: 'image',
      image: { id: 'media-1', mime_type: 'image/jpeg', caption: 'my receipt' },
    } as any;

    await service.processWebhook(payload);

    expect(stored[0]).toMatchObject({
      messageType: 'image',
      mediaId: 'media-1',
      mediaMimeType: 'image/jpeg',
      caption: 'my receipt',
    });
  });

  describe('status updates', () => {
    beforeEach(async () => {
      stored.push({
        id: 'msg-out',
        metaMessageId: 'wamid.OUT1',
        conversationId: 'conv-1',
        direction: 'OUTGOING',
        status: MessageStatus.SENT,
      });
    });

    it('advances sent -> delivered -> read', async () => {
      await service.processStatusUpdate({ id: 'wamid.OUT1', status: 'delivered' });
      expect(stored[0].status).toBe(MessageStatus.DELIVERED);

      await service.processStatusUpdate({ id: 'wamid.OUT1', status: 'read' });
      expect(stored[0].status).toBe(MessageStatus.READ);

      expect(gateway.emitMessageStatus).toHaveBeenCalledTimes(2);
    });

    it('never moves a status backwards when webhooks arrive out of order', async () => {
      await service.processStatusUpdate({ id: 'wamid.OUT1', status: 'read' });
      await service.processStatusUpdate({ id: 'wamid.OUT1', status: 'sent' });

      expect(stored[0].status).toBe(MessageStatus.READ);
    });

    it('records the error details of a failed message', async () => {
      await service.processStatusUpdate({
        id: 'wamid.OUT1',
        status: 'failed',
        errors: [
          {
            code: 131047,
            title: 'Re-engagement message',
            error_data: { details: 'Message failed to send because more than 24 hours have passed' },
          },
        ],
      });

      expect(stored[0]).toMatchObject({
        status: MessageStatus.FAILED,
        errorCode: '131047',
        errorTitle: 'Re-engagement message',
      });
      expect(gateway.emitMessageStatus).toHaveBeenCalledWith(
        expect.objectContaining({ status: MessageStatus.FAILED }),
      );
    });

    it('ignores a status for a message this app never sent', async () => {
      await service.processStatusUpdate({ id: 'wamid.UNKNOWN', status: 'delivered' });
      expect(gateway.emitMessageStatus).not.toHaveBeenCalled();
    });
  });

  it('ignores a payload that is not a whatsapp_business_account event', async () => {
    const result = await service.processWebhook({ object: 'page', entry: [] });
    expect(result.processed).toBe(0);
    expect(stored).toHaveLength(0);
  });
});

describe('service window', () => {
  it('is open within 24 hours of the last customer message', () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    expect(ConversationService.windowState(oneHourAgo).open).toBe(true);
  });

  it('is closed after 24 hours', () => {
    const yesterday = new Date(Date.now() - 25 * 60 * 60 * 1000);
    expect(ConversationService.windowState(yesterday).open).toBe(false);
  });

  it('is closed when the customer has never written', () => {
    expect(ConversationService.windowState(null).open).toBe(false);
  });
});
