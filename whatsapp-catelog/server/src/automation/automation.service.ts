import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { AuditService } from '../audit/audit.service';
import { SyncService } from '../catalog/services/sync.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAutoReplyRuleDto, UpdateAutoReplyRuleDto } from './dto/automation.dto';

const SYNC_JOB = 'catalog-sync';

/**
 * Scheduled catalog sync and auto-reply rule management.
 *
 * The nightly sync is what makes a daily-posting workflow safe to leave alone:
 * whatever drifted during the day - an edit in Commerce Manager, a failed
 * push - is reconciled overnight and shows up as a sync log the next morning.
 */
@Injectable()
export class AutomationService implements OnModuleInit {
  private readonly logger = new Logger(AutomationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sync: SyncService,
    private readonly audit: AuditService,
    private readonly scheduler: SchedulerRegistry,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    if (!this.config.get<boolean>('syncEnabled')) {
      this.logger.log('Scheduled catalog sync is disabled (CATALOG_SYNC_ENABLED=false)');
      return;
    }

    const expression = this.config.get<string>('syncCron');
    try {
      const job = new CronJob(expression, () => {
        void this.runScheduledSync();
      });
      this.scheduler.addCronJob(SYNC_JOB, job as any);
      job.start();
      this.logger.log(`Scheduled catalog sync registered (${expression})`);
    } catch (err) {
      // A bad cron expression must not stop the app from serving.
      this.logger.error(
        `CATALOG_SYNC_CRON "${expression}" is not a valid cron expression - scheduled sync is off. ` +
          `(${(err as Error).message})`,
      );
    }
  }

  /** Syncs every connected catalog, one after another. */
  async runScheduledSync() {
    const catalogs = await this.prisma.catalog.findMany({
      where: { status: 'CONNECTED' },
      select: { id: true, name: true },
    });

    if (!catalogs.length) {
      this.logger.debug('Scheduled sync skipped: no connected catalogs');
      return;
    }

    this.logger.log(`Scheduled sync starting for ${catalogs.length} catalog(s)`);

    for (const catalog of catalogs) {
      try {
        // push:true so products edited here during the day reach Meta even if
        // an earlier publish failed.
        const result = await this.sync.run({
          catalogId: catalog.id,
          push: true,
          trigger: 'scheduled',
          triggeredBy: 'system:scheduler',
        });
        this.logger.log(
          `Scheduled sync of "${catalog.name}": ${result.status} ` +
            `(+${result.created} ~${result.updated} -${result.deleted}, ${result.conflicts} conflicts)`,
        );
      } catch (err) {
        this.logger.error(`Scheduled sync of "${catalog.name}" threw: ${(err as Error).message}`);
      }
    }
  }

  /** State of the scheduled job, for the automation screen. */
  status() {
    const enabled = this.config.get<boolean>('syncEnabled');
    let nextRun: Date | null = null;

    if (enabled) {
      try {
        const job = this.scheduler.getCronJob(SYNC_JOB) as any;
        const next = job?.nextDate?.();
        nextRun = next ? new Date(next.toString()) : null;
      } catch {
        // The job failed to register (bad cron expression); reported as null.
      }
    }

    return {
      syncEnabled: enabled,
      syncCron: this.config.get<string>('syncCron'),
      syncScheduled: nextRun !== null,
      nextSyncAt: nextRun,
      autoReplyEnabled: this.config.get<boolean>('autoReplyEnabled'),
    };
  }

  // -----------------------------------------------------------------------
  // Auto-reply rules
  // -----------------------------------------------------------------------

  private async resolveBusinessId(): Promise<string> {
    const business = await this.prisma.business.findFirst({ orderBy: { createdAt: 'asc' } });
    if (business) return business.id;
    const created = await this.prisma.business.create({ data: { name: 'My Business' } });
    return created.id;
  }

  async listRules() {
    return this.prisma.autoReplyRule.findMany({
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async createRule(dto: CreateAutoReplyRuleDto, userEmail?: string) {
    const businessId = await this.resolveBusinessId();

    const rule = await this.prisma.autoReplyRule.create({
      data: {
        businessId,
        name: dto.name,
        keywords: AutomationService.normalizeKeywords(dto.keywords, dto.matchType),
        matchType: dto.matchType || 'contains',
        replyType: dto.replyType || 'text',
        replyText: dto.replyText || null,
        productRetailerIds: dto.productRetailerIds || [],
        collectionId: dto.collectionId || null,
        isActive: dto.isActive !== false,
        priority: dto.priority ?? 0,
        cooldownMinutes: dto.cooldownMinutes ?? 60,
      },
    });

    await this.audit.log({
      userEmail,
      action: 'auto_reply.created',
      entity: 'auto_reply_rule',
      entityId: rule.id,
      message: `Created rule "${rule.name}"`,
    });
    return rule;
  }

  async updateRule(id: string, dto: UpdateAutoReplyRuleDto, userEmail?: string) {
    await this.requireRule(id);

    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.keywords !== undefined) {
      // matchType may be changing in the same request; use the new one.
      const matchType = dto.matchType ?? (await this.requireRule(id)).matchType;
      data.keywords = AutomationService.normalizeKeywords(dto.keywords, matchType);
    }
    if (dto.matchType !== undefined) data.matchType = dto.matchType;
    if (dto.replyType !== undefined) data.replyType = dto.replyType;
    if (dto.replyText !== undefined) data.replyText = dto.replyText || null;
    if (dto.productRetailerIds !== undefined) data.productRetailerIds = dto.productRetailerIds;
    if (dto.collectionId !== undefined) data.collectionId = dto.collectionId || null;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.priority !== undefined) data.priority = dto.priority;
    if (dto.cooldownMinutes !== undefined) data.cooldownMinutes = dto.cooldownMinutes;

    const rule = await this.prisma.autoReplyRule.update({ where: { id }, data });

    await this.audit.log({
      userEmail,
      action: 'auto_reply.updated',
      entity: 'auto_reply_rule',
      entityId: id,
      message: `Updated rule "${rule.name}"`,
    });
    return rule;
  }

  async deleteRule(id: string, userEmail?: string) {
    const rule = await this.requireRule(id);

    await this.prisma.$transaction([
      this.prisma.autoReplyDispatch.deleteMany({ where: { ruleId: id } }),
      this.prisma.autoReplyRule.delete({ where: { id } }),
    ]);

    await this.audit.log({
      userEmail,
      action: 'auto_reply.deleted',
      entity: 'auto_reply_rule',
      entityId: id,
      message: `Deleted rule "${rule.name}"`,
    });
    return { success: true };
  }

  /** Clears the per-customer cooldown so a rule can fire again immediately. */
  async resetCooldowns(id: string) {
    await this.requireRule(id);
    const { count } = await this.prisma.autoReplyDispatch.deleteMany({ where: { ruleId: id } });
    return { cleared: count };
  }

  private async requireRule(id: string) {
    const rule = await this.prisma.autoReplyRule.findUnique({ where: { id } });
    if (!rule) throw new NotFoundException('Auto-reply rule not found.');
    return rule;
  }

  /**
   * Keywords are matched lower-cased, so they are stored that way - except for
   * regex rules, where lower-casing would silently change the pattern
   * (`\D` and `\d` mean opposite things).
   */
  private static normalizeKeywords(keywords?: string[], matchType?: string): string[] {
    const cleaned = (keywords || []).map((k) => String(k || '').trim()).filter(Boolean);
    return matchType === 'regex' ? cleaned : cleaned.map((k) => k.toLowerCase());
  }
}
