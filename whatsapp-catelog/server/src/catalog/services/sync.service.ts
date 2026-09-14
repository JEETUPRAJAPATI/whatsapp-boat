import { Injectable, Logger } from '@nestjs/common';
import { Prisma, SyncRunStatus, SyncStatus } from '@prisma/client';
import { AuditService } from '../../audit/audit.service';
import { MetaCatalogService, MetaProduct } from '../../meta/meta-catalog.service';
import { MetaTokenService } from '../../meta/meta-token.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CatalogService } from './catalog.service';

interface SyncTally {
  created: number;
  updated: number;
  deleted: number;
  unchanged: number;
  conflicts: number;
  failed: number;
  errors: Array<{ retailerId: string; message: string }>;
}

/** A locally-detectable difference between our row and Meta's item. */
type FieldDiff = { field: string; local: unknown; remote: unknown };

/**
 * Reconciles the local catalog with Meta's.
 *
 * The interesting case is not "copy Meta into the database" - it is what to do
 * when both sides changed. A local row with pending edits that also differs at
 * Meta is marked CONFLICT and left alone for a human, rather than one side
 * silently overwriting the other. Everything else resolves automatically.
 */
@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalogs: CatalogService,
    private readonly metaCatalog: MetaCatalogService,
    private readonly tokens: MetaTokenService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Pulls Meta's catalog, reconciles it, and optionally pushes local pending
   * changes back. Always writes a CatalogSyncLog row, success or failure.
   */
  async run(params: {
    catalogId?: string;
    push?: boolean;
    trigger?: 'manual' | 'scheduled';
    triggeredBy?: string;
  }) {
    const catalog = await this.catalogs.resolve(params.catalogId);
    const trigger = params.trigger || 'manual';

    const log = await this.prisma.catalogSyncLog.create({
      data: { catalogId: catalog.id, status: SyncRunStatus.RUNNING, trigger, triggeredBy: params.triggeredBy || null },
    });

    const tally: SyncTally = {
      created: 0,
      updated: 0,
      deleted: 0,
      unchanged: 0,
      conflicts: 0,
      failed: 0,
      errors: [],
    };

    try {
      const token = await this.tokens.forCatalog(catalog.id);

      // Push before pull, deliberately.
      //
      // Pulling first would re-examine a product that has pending local edits,
      // see that Meta still differs, and flag it as a conflict - including the
      // ones a human just resolved with "keep mine", which would then never
      // reach Meta. Sending local intent up first means the pull sees a Meta
      // that already reflects it.
      // Products the push already accounted for, so the pull does not count
      // them a second time as "unchanged".
      const pushed = params.push
        ? await this.push(catalog.id, catalog.metaCatalogId, token, tally)
        : new Set<string>();

      const remoteProducts = await this.metaCatalog.listProducts(token, catalog.metaCatalogId);
      this.logger.log(`Sync ${catalog.name}: Meta returned ${remoteProducts.length} products`);

      await this.pull(catalog.id, catalog.currency, remoteProducts, tally, pushed);

      const status = tally.failed
        ? SyncRunStatus.PARTIAL
        : tally.conflicts
          ? SyncRunStatus.PARTIAL
          : SyncRunStatus.SUCCESS;

      const finished = await this.finish(log.id, catalog.id, status, tally);

      await this.audit.log({
        userEmail: params.triggeredBy,
        action: 'catalog.synced',
        entity: 'catalog',
        entityId: catalog.id,
        result: status === SyncRunStatus.SUCCESS ? 'success' : 'failure',
        message: `${trigger} sync: +${tally.created} ~${tally.updated} -${tally.deleted}, ${tally.conflicts} conflicts`,
        metadata: { created: tally.created, updated: tally.updated, deleted: tally.deleted },
      });

      return finished;
    } catch (err) {
      const message = (err as any)?.response?.message || (err as Error).message;
      tally.errors.push({ retailerId: '-', message });

      const finished = await this.finish(log.id, catalog.id, SyncRunStatus.FAILED, tally);
      await this.audit.logFailure(
        { userEmail: params.triggeredBy, action: 'catalog.sync_failed', entity: 'catalog', entityId: catalog.id },
        err,
      );
      this.logger.error(`Sync of ${catalog.name} failed: ${message}`);
      return finished;
    }
  }

  private async finish(
    logId: string,
    catalogId: string,
    status: SyncRunStatus,
    tally: SyncTally,
  ) {
    const [log] = await this.prisma.$transaction([
      this.prisma.catalogSyncLog.update({
        where: { id: logId },
        data: {
          status,
          created: tally.created,
          updated: tally.updated,
          deleted: tally.deleted,
          unchanged: tally.unchanged,
          conflicts: tally.conflicts,
          failed: tally.failed,
          errors: tally.errors.length ? (tally.errors as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
          finishedAt: new Date(),
        },
      }),
      this.prisma.catalog.update({
        where: { id: catalogId },
        data: { lastSyncedAt: new Date(), lastSyncStatus: status },
      }),
    ]);
    return log;
  }

  // -----------------------------------------------------------------------
  // Pull: Meta -> local
  // -----------------------------------------------------------------------

  private async pull(
    catalogId: string,
    currency: string,
    remoteProducts: MetaProduct[],
    tally: SyncTally,
    pushedRetailerIds: Set<string> = new Set(),
  ) {
    const locals = await this.prisma.product.findMany({ where: { catalogId } });
    const localByRetailerId = new Map(locals.map((p) => [p.retailerId, p]));
    const seen = new Set<string>();

    for (const remote of remoteProducts) {
      const retailerId = remote.retailer_id;
      if (!retailerId) continue;
      seen.add(retailerId);

      // Already reconciled by the push a moment ago.
      if (pushedRetailerIds.has(retailerId)) continue;

      const local = localByRetailerId.get(retailerId);
      const mapped = SyncService.mapRemote(remote, currency);

      try {
        if (!local) {
          // Exists at Meta, unknown here: adopt it, already published.
          await this.prisma.product.create({
            data: {
              catalogId,
              retailerId,
              metaProductId: remote.id,
              ...mapped,
              isDraft: false,
              syncStatus: SyncStatus.SYNCED,
              lastSyncedAt: new Date(),
            },
          });
          tally.created += 1;
          continue;
        }

        // A row deleted locally but still live at Meta is a real conflict:
        // resurrect nothing, just flag it.
        if (local.deletedAt) {
          await this.prisma.product.update({
            where: { id: local.id },
            data: {
              syncStatus: SyncStatus.CONFLICT,
              syncError: 'Deleted here but still present in the Meta catalog.',
            },
          });
          tally.conflicts += 1;
          continue;
        }

        const diffs = SyncService.diff(local, mapped);

        if (!diffs.length) {
          if (local.syncStatus !== SyncStatus.SYNCED || !local.metaProductId) {
            await this.prisma.product.update({
              where: { id: local.id },
              data: {
                metaProductId: remote.id,
                syncStatus: SyncStatus.SYNCED,
                syncError: null,
                lastSyncedAt: new Date(),
                isDraft: false,
              },
            });
          }
          tally.unchanged += 1;
          continue;
        }

        // Both sides moved - do not guess which one is right.
        if (local.syncStatus === SyncStatus.PENDING && !local.isDraft) {
          await this.prisma.product.update({
            where: { id: local.id },
            data: {
              metaProductId: remote.id,
              syncStatus: SyncStatus.CONFLICT,
              syncError: `Changed in both places: ${diffs.map((d) => d.field).join(', ')}.`,
              metaErrors: { conflicts: diffs } as unknown as Prisma.InputJsonValue,
            },
          });
          tally.conflicts += 1;
          continue;
        }

        // Only Meta changed: Meta wins.
        await this.prisma.product.update({
          where: { id: local.id },
          data: {
            metaProductId: remote.id,
            ...mapped,
            isDraft: false,
            syncStatus: SyncStatus.SYNCED,
            syncError: null,
            metaErrors: Prisma.DbNull,
            lastSyncedAt: new Date(),
          },
        });
        tally.updated += 1;
      } catch (err) {
        tally.failed += 1;
        tally.errors.push({ retailerId, message: (err as Error).message });
        this.logger.warn(`Could not reconcile ${retailerId}: ${(err as Error).message}`);
      }
    }

    // Published locally but absent at Meta: someone deleted it in Commerce
    // Manager. Mark it, do not delete our row - the operator may want it back.
    for (const local of locals) {
      if (seen.has(local.retailerId) || local.deletedAt || local.isDraft) continue;
      if (!local.metaProductId) continue;

      await this.prisma.product.update({
        where: { id: local.id },
        data: {
          syncStatus: SyncStatus.CONFLICT,
          syncError: 'No longer present in the Meta catalog. It may have been deleted at Meta.',
        },
      });
      tally.deleted += 1;
    }
  }

  /** Translates one Meta item into our column shape. */
  private static mapRemote(remote: MetaProduct, fallbackCurrency: string) {
    const price = MetaCatalogService.parseDisplayPrice(remote);
    const currency = (remote.currency || fallbackCurrency).toUpperCase();

    return {
      name: remote.name || 'Untitled product',
      description: remote.description || '',
      price: new Prisma.Decimal(price ?? 0),
      currency,
      availability: SyncService.toAvailability(remote.availability),
      condition: SyncService.toCondition(remote.condition),
      brand: remote.brand || null,
      url: remote.url || null,
      imageUrl: remote.image_url || null,
      metaCategory: remote.category || null,
      metaStatus: remote.review_status?.status || null,
    };
  }

  private static toAvailability(value?: string): any {
    const normalized = String(value || 'in stock').toLowerCase().replace(/[\s-]+/g, '_');
    const map: Record<string, string> = {
      in_stock: 'IN_STOCK',
      out_of_stock: 'OUT_OF_STOCK',
      preorder: 'PREORDER',
      available_for_order: 'AVAILABLE_FOR_ORDER',
      discontinued: 'DISCONTINUED',
    };
    return map[normalized] || 'IN_STOCK';
  }

  private static toCondition(value?: string): any {
    const normalized = String(value || 'new').toLowerCase();
    const map: Record<string, string> = {
      new: 'NEW',
      refurbished: 'REFURBISHED',
      used: 'USED',
    };
    return map[normalized] || 'NEW';
  }

  /**
   * Compares only the fields Meta actually round-trips.
   *
   * Description is deliberately excluded from the price/name comparison
   * tolerance: Meta normalises whitespace and HTML in descriptions, so
   * comparing them byte-for-byte would report a permanent phantom difference.
   */
  private static diff(local: any, mapped: any): FieldDiff[] {
    const diffs: FieldDiff[] = [];

    const compare = (field: string, a: unknown, b: unknown) => {
      if (String(a ?? '') !== String(b ?? '')) diffs.push({ field, local: a, remote: b });
    };

    compare('name', local.name, mapped.name);
    compare('availability', local.availability, mapped.availability);
    compare('condition', local.condition, mapped.condition);
    compare('currency', local.currency, mapped.currency);
    compare('brand', local.brand, mapped.brand);
    compare('url', local.url, mapped.url);

    // Money compared numerically, so 2500.0 and 2500.00 are the same price.
    if (Math.abs(Number(local.price) - Number(mapped.price)) > 0.009) {
      diffs.push({ field: 'price', local: Number(local.price), remote: Number(mapped.price) });
    }

    const normalize = (text: unknown) => String(text ?? '').replace(/\s+/g, ' ').trim();
    if (normalize(local.description) !== normalize(mapped.description)) {
      diffs.push({ field: 'description', local: local.description, remote: mapped.description });
    }

    return diffs;
  }

  // -----------------------------------------------------------------------
  // Push: local -> Meta
  // -----------------------------------------------------------------------

  /**
   * Pushes published products whose local copy is ahead, and returns the
   * retailer ids it handled so the pull can skip them.
   *
   * Conflicts are skipped on purpose - resolving one is an explicit human
   * decision, and "keep mine" re-queues the product as PENDING so it is picked
   * up here on the next run.
   */
  private async push(
    catalogId: string,
    metaCatalogId: string,
    token: string,
    tally: SyncTally,
  ): Promise<Set<string>> {
    const handled = new Set<string>();

    const pending = await this.prisma.product.findMany({
      where: {
        catalogId,
        deletedAt: null,
        isDraft: false,
        syncStatus: SyncStatus.PENDING,
      },
      include: { media: true },
      take: 500,
    });

    if (!pending.length) return handled;
    this.logger.log(`Pushing ${pending.length} pending products to Meta`);

    for (const product of pending) {
      const images = product.media.filter((m) => m.kind === 'IMAGE');
      const primary = images.find((m) => m.isPrimary) || images[0];

      const input = {
        retailerId: product.retailerId,
        name: product.name,
        description: product.description,
        price: Number(product.price),
        currency: product.currency,
        availability: product.availability,
        condition: product.condition,
        imageUrl: product.imageUrl || primary?.url || null,
        additionalImageUrls: images.filter((m) => m.id !== primary?.id).map((m) => m.url),
        url: product.url,
        brand: product.brand,
        category: product.metaCategory,
        salePrice: product.salePrice != null ? Number(product.salePrice) : null,
      };

      try {
        let metaProductId = product.metaProductId;
        if (metaProductId) {
          await this.metaCatalog.updateProduct(token, metaProductId, input);
        } else {
          const created = await this.metaCatalog.createProduct(token, metaCatalogId, input);
          metaProductId = created.id;
        }

        await this.prisma.product.update({
          where: { id: product.id },
          data: {
            metaProductId,
            syncStatus: SyncStatus.SYNCED,
            syncError: null,
            lastSyncedAt: new Date(),
          },
        });
        tally.updated += 1;
        handled.add(product.retailerId);
      } catch (err) {
        const message = (err as any)?.response?.message || (err as Error).message;
        await this.prisma.product.update({
          where: { id: product.id },
          data: { syncStatus: SyncStatus.FAILED, syncError: String(message).slice(0, 500) },
        });
        tally.failed += 1;
        tally.errors.push({ retailerId: product.retailerId, message });
        // Failed items are left out of `handled` so the pull still inspects them.
      }
    }

    return handled;
  }

  // -----------------------------------------------------------------------
  // Conflict resolution
  // -----------------------------------------------------------------------

  /** Lists what a human still has to decide. */
  async conflicts(catalogId?: string) {
    const catalog = await this.catalogs.resolve(catalogId);
    const products = await this.prisma.product.findMany({
      where: { catalogId: catalog.id, syncStatus: SyncStatus.CONFLICT },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });

    return products.map((p) => ({
      id: p.id,
      retailerId: p.retailerId,
      name: p.name,
      syncError: p.syncError,
      details: p.metaErrors,
      deletedAt: p.deletedAt,
      updatedAt: p.updatedAt,
    }));
  }

  /**
   * Resolves one conflict in the chosen direction.
   * `local` re-queues our version for push; `meta` accepts Meta's version on
   * the next pull.
   */
  async resolveConflict(productId: string, resolution: 'local' | 'meta', userEmail?: string) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) return { success: false };

    await this.prisma.product.update({
      where: { id: productId },
      data: {
        syncStatus: SyncStatus.PENDING,
        syncError:
          resolution === 'local'
            ? 'Queued to overwrite the Meta version on the next sync.'
            : 'Queued to accept the Meta version on the next sync.',
        // Accepting Meta means our edits are abandoned, so the next pull is
        // free to overwrite this row.
        ...(resolution === 'meta' ? { isDraft: false } : {}),
      },
    });

    await this.audit.log({
      userEmail,
      action: 'catalog.conflict_resolved',
      entity: 'product',
      entityId: productId,
      message: `Conflict on "${product.name}" resolved in favour of ${resolution}`,
    });

    return { success: true, resolution };
  }
}
