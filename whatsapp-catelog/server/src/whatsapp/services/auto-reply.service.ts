import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AutoReplyRule } from '@prisma/client';
import { AuditService } from '../../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MessagingService } from './messaging.service';
import type { ParsedMessage } from './webhook.service';

/**
 * Answers inbound customer messages from keyword rules.
 *
 * Designed around one constraint that is easy to get wrong: an auto-responder
 * that fires twice looks broken and, at WhatsApp scale, gets a number
 * flagged. So every rule carries a per-customer cooldown, only the
 * highest-priority match fires, and a send failure is recorded rather than
 * retried into a loop.
 */
@Injectable()
export class AutoReplyService {
  private readonly logger = new Logger(AutoReplyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly messaging: MessagingService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  private get enabled(): boolean {
    return this.config.get<boolean>('autoReplyEnabled');
  }

  /**
   * Called from the webhook for every newly stored inbound message.
   * Returns the rule that fired, or null.
   */
  async handleInbound(params: {
    parsed: ParsedMessage;
    conversationId: string;
    phoneNumberId?: string;
  }): Promise<AutoReplyRule | null> {
    if (!this.enabled) return null;

    // Only free-text-ish messages trigger keywords. Reacting to a customer's
    // own order confirmation or a reaction emoji would be noise.
    const text = params.parsed.text;
    if (!text || !['text', 'interactive', 'button'].includes(params.parsed.type)) return null;

    const rules = await this.prisma.autoReplyRule.findMany({
      where: { isActive: true },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    });
    if (!rules.length) return null;

    const rule = rules.find((candidate) => AutoReplyService.matches(candidate, text));
    if (!rule) return null;

    if (await this.isCoolingDown(rule, params.parsed.from)) {
      this.logger.debug(`Rule "${rule.name}" is in cooldown for this customer`);
      return null;
    }

    try {
      await this.dispatch(rule, params.parsed.from, params.phoneNumberId);
      await this.recordFired(rule, params.parsed.from);

      this.logger.log(`Auto-reply "${rule.name}" sent to ${this.mask(params.parsed.from)}`);
      await this.audit.log({
        userEmail: 'system:auto-reply',
        action: 'auto_reply.sent',
        entity: 'auto_reply_rule',
        entityId: rule.id,
        message: `Rule "${rule.name}" replied to an inbound message`,
      });
      return rule;
    } catch (err) {
      // The window being closed is the normal case for a first-contact
      // customer, not a fault worth alarming about.
      const code = (err as any)?.response?.code;
      const level = code === 'SERVICE_WINDOW_CLOSED' ? 'debug' : 'warn';
      this.logger[level](`Auto-reply "${rule.name}" could not send: ${(err as Error).message}`);

      await this.audit.logFailure(
        {
          userEmail: 'system:auto-reply',
          action: 'auto_reply.failed',
          entity: 'auto_reply_rule',
          entityId: rule.id,
        },
        err,
      );
      return null;
    }
  }

  /** Pure matcher, so rule behaviour can be reasoned about (and tested) alone. */
  static matches(rule: AutoReplyRule, message: string): boolean {
    const text = String(message || '').toLowerCase().trim();
    if (!text || !rule.keywords?.length) return false;

    return rule.keywords.some((keywordRaw) => {
      const keyword = String(keywordRaw || '').toLowerCase().trim();
      if (!keyword) return false;

      switch (rule.matchType) {
        case 'exact':
          return text === keyword;
        case 'regex':
          try {
            return new RegExp(keywordRaw, 'i').test(message);
          } catch {
            // A malformed pattern must not throw inside the webhook path.
            return false;
          }
        case 'contains':
        default:
          return text.includes(keyword);
      }
    });
  }

  private async isCoolingDown(rule: AutoReplyRule, phoneNumber: string): Promise<boolean> {
    if (!rule.cooldownMinutes) return false;

    const dispatch = await this.prisma.autoReplyDispatch.findUnique({
      where: { ruleId_phoneNumber: { ruleId: rule.id, phoneNumber } },
    });
    if (!dispatch) return false;

    const readyAt = dispatch.firedAt.getTime() + rule.cooldownMinutes * 60_000;
    return readyAt > Date.now();
  }

  private async recordFired(rule: AutoReplyRule, phoneNumber: string) {
    await this.prisma.$transaction([
      this.prisma.autoReplyDispatch.upsert({
        where: { ruleId_phoneNumber: { ruleId: rule.id, phoneNumber } },
        create: { ruleId: rule.id, phoneNumber },
        update: { firedAt: new Date() },
      }),
      this.prisma.autoReplyRule.update({
        where: { id: rule.id },
        data: { lastFiredAt: new Date(), timesFired: { increment: 1 } },
      }),
    ]);
  }

  private async dispatch(rule: AutoReplyRule, to: string, phoneNumberId?: string) {
    const sentBy = `auto-reply:${rule.name}`;
    const common = { to, sentBy, phoneNumberId };

    switch (rule.replyType) {
      case 'catalog':
        return this.messaging.sendCatalog({
          ...common,
          body: rule.replyText || 'Here is our full catalogue. Tap to browse.',
          thumbnailProductRetailerId: rule.productRetailerIds?.[0],
        });

      case 'product': {
        const retailerId = rule.productRetailerIds?.[0];
        if (!retailerId) {
          throw new Error(`Rule "${rule.name}" is set to send a product but names none.`);
        }
        return this.messaging.sendProduct({
          ...common,
          productRetailerId: retailerId,
          body: rule.replyText || undefined,
        });
      }

      case 'product_list': {
        if (rule.collectionId) {
          return this.messaging.sendProductList({
            ...common,
            collectionId: rule.collectionId,
            header: rule.name.slice(0, 60),
            body: rule.replyText || 'Here are some options for you.',
          });
        }
        if (!rule.productRetailerIds?.length) {
          throw new Error(`Rule "${rule.name}" is set to send a product list but names no products.`);
        }
        return this.messaging.sendProductList({
          ...common,
          header: rule.name.slice(0, 60),
          body: rule.replyText || 'Here are some options for you.',
          sections: [
            {
              title: rule.name.slice(0, 24),
              productRetailerIds: rule.productRetailerIds.slice(0, 30),
            },
          ],
        });
      }

      case 'text':
      default:
        if (!rule.replyText) throw new Error(`Rule "${rule.name}" has no reply text.`);
        return this.messaging.sendText({ ...common, message: rule.replyText });
    }
  }

  /** Lets the admin panel try a rule against sample text without sending. */
  async preview(text: string) {
    const rules = await this.prisma.autoReplyRule.findMany({
      where: { isActive: true },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    });
    const matched = rules.find((rule) => AutoReplyService.matches(rule, text));

    return {
      matched: Boolean(matched),
      rule: matched
        ? { id: matched.id, name: matched.name, replyType: matched.replyType, replyText: matched.replyText }
        : null,
    };
  }

  private mask(phone: string): string {
    return phone.length > 4 ? `${'*'.repeat(phone.length - 4)}${phone.slice(-4)}` : '****';
  }
}
