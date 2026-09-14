import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  userEmail?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  result?: 'success' | 'failure';
  message?: string | null;
  metadata?: Prisma.InputJsonValue | null;
  ipAddress?: string | null;
}

/**
 * Append-only record of every state-changing action.
 *
 * Writing an audit row must never be the reason a user-facing operation fails,
 * so every failure here is logged and swallowed.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userEmail: entry.userEmail || null,
          action: entry.action,
          entity: entry.entity,
          entityId: entry.entityId || null,
          result: entry.result || 'success',
          message: entry.message ? entry.message.slice(0, 500) : null,
          metadata: (entry.metadata ?? undefined) as Prisma.InputJsonValue,
          ipAddress: entry.ipAddress || null,
        },
      });
    } catch (err) {
      this.logger.warn(`Could not write audit log (${entry.action}): ${(err as Error).message}`);
    }
  }

  /** Convenience wrapper for the failure branch of a try/catch. */
  async logFailure(entry: Omit<AuditEntry, 'result'>, error: unknown): Promise<void> {
    await this.log({
      ...entry,
      result: 'failure',
      message: (error as Error)?.message || 'Unknown error',
    });
  }

  async list(params: {
    page?: number;
    pageSize?: number;
    entity?: string;
    action?: string;
    result?: string;
  }) {
    const page = Math.max(1, params.page || 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize || 25));

    const where: Prisma.AuditLogWhereInput = {};
    if (params.entity) where.entity = params.entity;
    if (params.action) where.action = { contains: params.action, mode: 'insensitive' };
    if (params.result) where.result = params.result;

    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { items, total, page, pageSize, pages: Math.ceil(total / pageSize) || 1 };
  }
}
