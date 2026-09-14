import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConnectionStatus, SyncStatus } from '@prisma/client';
import { MetaCatalogService } from '../../meta/meta-catalog.service';
import { MetaTokenService } from '../../meta/meta-token.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AccountService } from '../../whatsapp/services/account.service';

/**
 * Owns catalogs themselves: which ones exist, which one is default, and the
 * dashboard counters. Product-level work lives in ProductService.
 */
@Injectable()
export class CatalogService {
  private readonly logger = new Logger(CatalogService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly metaCatalog: MetaCatalogService,
    private readonly tokens: MetaTokenService,
    private readonly accounts: AccountService,
  ) {}

  /**
   * The catalog a request works against.
   *
   * Almost every product route accepts an optional catalogId; resolving it in
   * one place is what keeps the system genuinely multi-catalog instead of
   * quietly assuming there is only ever one.
   */
  async resolve(catalogId?: string) {
    if (catalogId) {
      const catalog = await this.prisma.catalog.findFirst({
        where: { OR: [{ id: catalogId }, { metaCatalogId: catalogId }] },
      });
      if (!catalog) throw new NotFoundException('Catalog not found.');
      return catalog;
    }

    const catalog = await this.prisma.catalog.findFirst({
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    if (!catalog) {
      throw new BadRequestException({
        statusCode: 400,
        message:
          'No product catalog is connected yet. Connect a WhatsApp account, then connect or ' +
          'create a catalog from the Catalog page.',
        code: 'CATALOG_NOT_FOUND',
      });
    }
    return catalog;
  }

  async list() {
    const catalogs = await this.prisma.catalog.findMany({
      include: {
        account: { select: { id: true, name: true, wabaId: true, status: true } },
        _count: { select: { products: true, collections: true } },
      },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });

    return catalogs.map((catalog) => ({
      id: catalog.id,
      metaCatalogId: catalog.metaCatalogId,
      name: catalog.name,
      vertical: catalog.vertical,
      currency: catalog.currency,
      status: catalog.status,
      isDefault: catalog.isDefault,
      lastSyncedAt: catalog.lastSyncedAt,
      lastSyncStatus: catalog.lastSyncStatus,
      account: catalog.account,
      productCount: catalog._count.products,
      collectionCount: catalog._count.collections,
    }));
  }

  /** Everything the /catalog dashboard shows, for one catalog. */
  async overview(catalogId?: string) {
    const catalog = await this.resolve(catalogId);
    const where = { catalogId: catalog.id, deletedAt: null };

    const [
      total,
      active,
      outOfStock,
      drafts,
      pending,
      failed,
      conflicts,
      collections,
      categories,
      lastSync,
      account,
    ] = await Promise.all([
      this.prisma.product.count({ where }),
      this.prisma.product.count({ where: { ...where, isActive: true, isDraft: false } }),
      this.prisma.product.count({ where: { ...where, availability: 'OUT_OF_STOCK' } }),
      this.prisma.product.count({ where: { ...where, isDraft: true } }),
      this.prisma.product.count({ where: { ...where, syncStatus: SyncStatus.PENDING } }),
      this.prisma.product.count({ where: { ...where, syncStatus: SyncStatus.FAILED } }),
      this.prisma.product.count({ where: { ...where, syncStatus: SyncStatus.CONFLICT } }),
      this.prisma.collection.count({ where: { catalogId: catalog.id } }),
      this.prisma.category.count(),
      this.prisma.catalogSyncLog.findFirst({
        where: { catalogId: catalog.id },
        orderBy: { startedAt: 'desc' },
      }),
      this.prisma.whatsappAccount.findUnique({
        where: { id: catalog.whatsappAccountId },
        include: { phoneNumbers: true },
      }),
    ]);

    return {
      catalog: {
        id: catalog.id,
        metaCatalogId: catalog.metaCatalogId,
        name: catalog.name,
        currency: catalog.currency,
        status: catalog.status,
        lastSyncedAt: catalog.lastSyncedAt,
        lastSyncStatus: catalog.lastSyncStatus,
      },
      account: account
        ? {
            id: account.id,
            name: account.name,
            wabaId: account.wabaId,
            status: account.status,
            phoneNumbers: account.phoneNumbers.length,
            catalogVisible: account.phoneNumbers.some((n) => n.catalogVisible),
          }
        : null,
      counts: {
        total,
        active,
        outOfStock,
        drafts,
        pending,
        failed,
        conflicts,
        collections,
        categories,
      },
      lastSync: lastSync
        ? {
            id: lastSync.id,
            status: lastSync.status,
            trigger: lastSync.trigger,
            created: lastSync.created,
            updated: lastSync.updated,
            deleted: lastSync.deleted,
            conflicts: lastSync.conflicts,
            failed: lastSync.failed,
            startedAt: lastSync.startedAt,
            finishedAt: lastSync.finishedAt,
          }
        : null,
    };
  }

  /** Catalogs visible at Meta that are not yet tracked here. */
  async discover(accountId: string) {
    const account = await this.accounts.requireAccountRecord(accountId);
    const token = await this.tokens.forAccount(accountId);

    const [connected, owned] = await Promise.all([
      this.metaCatalog.listCatalogsForWaba(token, account.wabaId).catch(() => []),
      account.business?.metaBusinessId
        ? this.metaCatalog
            .listCatalogsForBusiness(token, account.business.metaBusinessId)
            .catch(() => [])
        : Promise.resolve([]),
    ]);

    const connectedIds = new Set(connected.map((c) => c.id));
    const tracked = new Set(
      (await this.prisma.catalog.findMany({ select: { metaCatalogId: true } })).map(
        (c) => c.metaCatalogId,
      ),
    );

    const merged = new Map<string, any>();
    for (const catalog of [...connected, ...owned]) {
      merged.set(catalog.id, {
        ...catalog,
        connectedToWhatsapp: connectedIds.has(catalog.id),
        alreadyTracked: tracked.has(catalog.id),
      });
    }
    return [...merged.values()];
  }

  /** Links an existing Meta catalog to a WABA and starts tracking it here. */
  async connect(params: { accountId: string; metaCatalogId: string }) {
    const account = await this.accounts.requireAccountRecord(params.accountId);
    const token = await this.tokens.forAccount(params.accountId);

    const remote = await this.metaCatalog.getCatalog(token, params.metaCatalogId);

    // Connecting an already-connected catalog is a no-op at Meta but errors,
    // so a failure here is only worth a warning.
    await this.metaCatalog
      .connectCatalogToWaba(token, account.wabaId, params.metaCatalogId)
      .catch((err) => {
        this.logger.warn(
          `Could not link catalog ${params.metaCatalogId} to WABA ${account.wabaId}: ${(err as Error).message}`,
        );
      });

    const existingCount = await this.prisma.catalog.count();

    return this.prisma.catalog.upsert({
      where: { metaCatalogId: params.metaCatalogId },
      create: {
        whatsappAccountId: account.id,
        metaCatalogId: params.metaCatalogId,
        name: remote.name || `Catalog ${params.metaCatalogId}`,
        vertical: remote.vertical || null,
        currency: account.currency || 'INR',
        status: ConnectionStatus.CONNECTED,
        isDefault: existingCount === 0,
      },
      update: {
        whatsappAccountId: account.id,
        name: remote.name || undefined,
        status: ConnectionStatus.CONNECTED,
      },
    });
  }

  /** Creates a brand-new catalog at Meta, then links and tracks it. */
  async create(params: { accountId: string; name: string; vertical?: string }) {
    const account = await this.accounts.requireAccountRecord(params.accountId);
    const businessId = account.business?.metaBusinessId;

    if (!businessId) {
      throw new BadRequestException({
        statusCode: 400,
        message:
          'This account has no Meta Business Portfolio id, so a catalog cannot be created for ' +
          'it. Create the catalog in Meta Commerce Manager and connect it here instead.',
        code: 'BUSINESS_ID_MISSING',
      });
    }

    const token = await this.tokens.forAccount(params.accountId);
    const created = await this.metaCatalog.createCatalog(
      token,
      businessId,
      params.name,
      params.vertical || 'commerce',
    );

    return this.connect({ accountId: params.accountId, metaCatalogId: created.id });
  }

  async setDefault(catalogId: string) {
    const catalog = await this.resolve(catalogId);
    await this.prisma.$transaction([
      this.prisma.catalog.updateMany({
        where: { id: { not: catalog.id } },
        data: { isDefault: false },
      }),
      this.prisma.catalog.update({ where: { id: catalog.id }, data: { isDefault: true } }),
    ]);
    return this.prisma.catalog.findUnique({ where: { id: catalog.id } });
  }

  async syncHistory(catalogId?: string, limit = 20) {
    const catalog = await this.resolve(catalogId);
    return this.prisma.catalogSyncLog.findMany({
      where: { catalogId: catalog.id },
      orderBy: { startedAt: 'desc' },
      take: Math.min(limit, 100),
    });
  }
}
