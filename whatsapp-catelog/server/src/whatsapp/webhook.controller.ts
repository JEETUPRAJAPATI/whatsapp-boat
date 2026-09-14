import { Body, Controller, ForbiddenException, Get, HttpCode, Logger, Post, Query, Req } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Request } from 'express';
import { MetaMessagingService } from '../meta/meta-messaging.service';
import { WebhookService } from './services/webhook.service';

/**
 * Meta's webhook endpoints.
 *
 * Deliberately unauthenticated - Meta cannot send a bearer token. Trust comes
 * from the verify token on GET and the X-Hub-Signature-256 HMAC on POST, which
 * is why META_APP_SECRET matters in production.
 */
@SkipThrottle()
@Controller('api/whatsapp/webhook')
export class WebhookController {
  private readonly logger = new Logger('WhatsApp Webhook');

  constructor(
    private readonly meta: MetaMessagingService,
    private readonly webhook: WebhookService,
  ) {}

  /** Verification handshake: echo hub.challenge when the token matches. */
  @Get()
  verify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ): string {
    const result = this.meta.verifyWebhook(mode, token, challenge);
    if (result === null) throw new ForbiddenException('Verification failed');
    return result;
  }

  /**
   * Event delivery. Always answers 200 quickly: Meta retries - and eventually
   * disables - a webhook that errors or is slow, so processing failures are
   * logged rather than surfaced as a non-200.
   */
  @HttpCode(200)
  @Post()
  async receive(@Req() req: Request & { rawBody?: Buffer }, @Body() body: any) {
    const signature = req.headers['x-hub-signature-256'] as string | undefined;

    if (!this.meta.verifySignature(req.rawBody, signature)) {
      this.logger.warn('Rejected a webhook with an invalid X-Hub-Signature-256');
      throw new ForbiddenException('Invalid signature');
    }

    try {
      const result = await this.webhook.processWebhook(body);
      return { status: 'ok', processed: result.processed };
    } catch (err) {
      this.logger.error(`Webhook processing error: ${(err as Error).message}`);
      return { status: 'ok' };
    }
  }
}
