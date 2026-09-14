import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, SyncStatus } from '@prisma/client';
import { AuditService } from '../../audit/audit.service';
import { MetaCatalogService } from '../../meta/meta-catalog.service';
import { MetaTokenService } from '../../meta/meta-token.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCollectionDto, UpdateCollectionDto } from '../dto/catalog.dto';
import { CatalogService } from './catalog.service';

const COLLECTION_INCLUDE = {
  products: {
    include: {
      product: {
        select: {
          id: true,
          name: true,
          retailerId: true,
          price: true,
          currency: true,
          imageUrl: true,
          availability: true,
          isDraft: true,
          metaProductId: true,
        },
      },
    },
    orderBy: { sortOrder: 'asc' },
  },
  catalog: { select: { id: true, name: true, metaCatalogId: true, currency: true } },
} satisfies Prisma.CollectionInclude;

/**
 * Collections, which Meta calls product sets.
 *
 * Meta product sets are filter expressions rather than lists, so a hand-picked
 * collection is stored locally as membership rows and expressed to Meta as
 * "retailer_id is any of [...]". That keeps the admin UX simple (tick the
 * products you want) without inventing anything Meta does not support.
 */
@Injectable()
export class CollectionService {
  private readonly logger = new Logger(CollectionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalogs: CatalogService,
    private readonly metaCatalog: MetaCatalogService,
    private readonly tokens: MetaTokenService,
    private readonly audit: AuditService,
  ) {}

  async list(catalogId?: string) {
    const catalog = await this.catalogs.resolve(catalogId);
    const collections = await this.prisma.collection.findMany({
      where: { catalogId: catalog.id },
      include: { _count: { select: { products: true } } },
      orderBy: { createdAt: 'desc' },
    });

    return collections.map((collection) => ({
      id: collection.id,
      name: collection.name,
      description: collection.description,
      metaProductSetId: collection.metaProductSetId,
      syncStatus: collection.syncStatus,
      syncError: collection.syncError,
      isAutomatic: Boolean(collection.filter) && collection._count.products === 0,
      productCount: collection._count.products,
      createdAt: collection.createdAt,
      updatedAt: collection.updatedAt,
    }));
  }

  async findOne(id: string) {
    const collection = await this.prisma.collection.findUnique({
      where: { id },
      include: COLLECTION_INCLUDE,
    });
    if (!collection) throw new NotFoundException('Collection not found.');
    return CollectionService.serialize(collection);
  }

  async create(dto: CreateCollectionDto, userEmail?: string) {
    const catalog = await this.catalogs.resolve(dto.catalogId);

    const collection = await this.prisma.collection.create({
      data: {
        catalogId: catalog.id,
        name: dto.name,
        description: dto.description || null,
        filter: (dto.filter ?? undefined) as Prisma.InputJsonValue,
        syncStatus: SyncStatus.PENDING,
      },
    });

    if (dto.productIds?.length) {
      await this.setProducts(collection.id, dto.productIds);
    }

    await this.audit.log({
      userEmail,
      action: 'collection.created',
      entity: 'collection',
      entityId: collection.id,
      message: `Created collection "${collection.name}"`,
    });

    if (dto.publish) return this.publish(collection.id, userEmail);
    return this.findOne(collection.id);
  }

  async update(id: string, dto: UpdateCollectionDto, userEmail?: string) {
    const collection = await this.requireCollection(id);

    const data: Prisma.CollectionUpdateInput = { syncStatus: SyncStatus.PENDING };
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description || null;
    if (dto.filter !== undefined) data.filter = dto.filter as Prisma.InputJsonValue;

    await this.prisma.collection.update({ where: { id }, data });

    if (dto.productIds) await this.setProducts(id, dto.productIds);

    await this.audit.log({
      userEmail,
      action: 'collection.updated',
      entity: 'collection',
      entityId: id,
      message: `Updated collection "${dto.name || collection.name}"`,
    });

    // Keep a live product set in step with the local edit.
    if (collection.metaProductSetId) return this.publish(id, userEmail);
    return this.findOne(id);
  }

  /** Replaces membership wholesale - simpler to reason about than diffing. */
  private async setProducts(collectionId: string, productIds: string[]) {
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, deletedAt: null },
      select: { id: true },
    });
    const valid = products.map((p) => p.id);

    await this.prisma.$transaction([
      this.prisma.collectionProduct.deleteMany({ where: { collectionId } }),
      this.prisma.collectionProduct.createMany({
        data: valid.map((productId, index) => ({ collectionId, productId, sortOrder: index })),
        skipDuplicates: true,
      }),
    ]);
  }

  async addProducts(id: string, productIds: string[], userEmail?: string) {
    const collection = await this.requireCollection(id);
    const existing = await this.prisma.collectionProduct.count({ where: { collectionId: id } });

    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, deletedAt: null, catalogId: collection.catalogId },
      select: { id: true },
    });

    await this.prisma.collectionProduct.createMany({
      data: products.map((p, index) => ({
        collectionId: id,
        productId: p.id,
        sortOrder: existing + index,
      })),
      skipDuplicates: true,
    });
    await this.prisma.collection.update({
      where: { id },
      data: { syncStatus: SyncStatus.PENDING },
    });

    await this.audit.log({
      userEmail,
      action: 'collection.products_added',
      entity: 'collection',
      entityId: id,
      message: `Added ${products.length} products to "${collection.name}"`,
    });

    if (collection.metaProductSetId) return this.publish(id, userEmail);
    return this.findOne(id);
  }

  async removeProducts(id: string, productIds: string[], userEmail?: string) {
    const collection = await this.requireCollection(id);

    const { count } = await this.prisma.collectionProduct.deleteMany({
      where: { collectionId: id, productId: { in: productIds } },
    });
    await this.prisma.collection.update({
      where: { id },
      data: { syncStatus: SyncStatus.PENDING },
    });

    await this.audit.log({
      userEmail,
      action: 'collection.products_removed',
      entity: 'collection',
      entityId: id,
      message: `Removed ${count} products from "${collection.name}"`,
    });

    if (collection.metaProductSetId) return this.publish(id, userEmail);
    return this.findOne(id);
  }

  /** Creates or updates the matching Meta product set. */
  async publish(id: string, userEmail?: string) {
    const collection = await this.prisma.collection.findUnique({
      where: { id },
      include: COLLECTION_INCLUDE,
    });
    if (!collection) throw new NotFoundException('Collection not found.');

    const filter = this.buildFilter(collection);
    const token = await this.tokens.forCatalog(collection.catalogId);

    try {
      let metaProductSetId = collection.metaProductSetId;

      if (metaProductSetId) {
        await this.metaCatalog.updateProductSet(token, metaProductSetId, {
          name: collection.name,
          filter,
        });
      } else {
        const created = await this.metaCatalog.createProductSet(
          token,
          collection.catalog.metaCatalogId,
          collection.name,
          filter,
        );
        metaProductSetId = created.id;
      }

      await this.prisma.collection.update({
        where: { id },
        data: {
          metaProductSetId,
          filter: filter as Prisma.InputJsonValue,
          syncStatus: SyncStatus.SYNCED,
          syncError: null,
        },
      });

      await this.audit.log({
        userEmail,
        action: 'collection.published',
        entity: 'collection',
        entityId: id,
        message: `Published "${collection.name}" as Meta product set ${metaProductSetId}`,
      });

      return this.findOne(id);
    } catch (err) {
      const message = (err as any)?.response?.message || (err as Error).message;
      await this.prisma.collection.update({
        where: { id },
        data: { syncStatus: SyncStatus.FAILED, syncError: String(message).slice(0, 500) },
      });
      await this.audit.logFailure(
        { userEmail, action: 'collection.publish_failed', entity: 'collection', entityId: id },
        err,
      );
      throw err;
    }
  }

  /**
   * A hand-picked collection becomes a retailer_id filter; an explicitly
   * authored filter is used as-is.
   */
  private buildFilter(
    collection: Prisma.CollectionGetPayload<{ include: typeof COLLECTION_INCLUDE }>,
  ): Record<string, unknown> {
    const retailerIds = collection.products
      .filter((row) => row.product && row.product.metaProductId)
      .map((row) => row.product.retailerId);

    if (retailerIds.length) return MetaCatalogService.retailerIdFilter(retailerIds);

    if (collection.filter && typeof collection.filter === 'object') {
      return collection.filter as Record<string, unknown>;
    }

    throw new BadRequestException({
      statusCode: 400,
      message:
        'This collection has no published products and no filter, so Meta has nothing to put in ' +
        'the product set. Add published products first.',
      code: 'COLLECTION_EMPTY',
    });
  }

  async remove(id: string, userEmail?: string) {
    const collection = await this.requireCollection(id);

    if (collection.metaProductSetId) {
      try {
        const token = await this.tokens.forCatalog(collection.catalogId);
        await this.metaCatalog.deleteProductSet(token, collection.metaProductSetId);
      } catch (err) {
        const alreadyGone =
          (err as any)?.status === 404 || (err as any)?.response?.code === 'OBJECT_NOT_FOUND';
        if (!alreadyGone) {
          await this.prisma.collection.update({
            where: { id },
            data: {
              syncStatus: SyncStatus.CONFLICT,
              syncError: `Delete failed at Meta: ${(err as any)?.response?.message || (err as Error).message}`,
            },
          });
          await this.audit.logFailure(
            { userEmail, action: 'collection.delete_failed', entity: 'collection', entityId: id },
            err,
          );
          throw err;
        }
        this.logger.warn(`Product set ${collection.metaProductSetId} was already absent at Meta.`);
      }
    }

    await this.prisma.collection.delete({ where: { id } });
    await this.audit.log({
      userEmail,
      action: 'collection.deleted',
      entity: 'collection',
      entityId: id,
      message: `Deleted collection "${collection.name}"`,
    });
    return { success: true };
  }

  private async requireCollection(id: string) {
    const collection = await this.prisma.collection.findUnique({ where: { id } });
    if (!collection) throw new NotFoundException('Collection not found.');
    return collection;
  }

  static serialize(
    collection: Prisma.CollectionGetPayload<{ include: typeof COLLECTION_INCLUDE }>,
  ) {
    return {
      id: collection.id,
      catalogId: collection.catalogId,
      metaProductSetId: collection.metaProductSetId,
      name: collection.name,
      description: collection.description,
      filter: collection.filter,
      syncStatus: collection.syncStatus,
      syncError: collection.syncError,
      createdAt: collection.createdAt,
      updatedAt: collection.updatedAt,
      catalog: collection.catalog,
      products: collection.products.map((row) => ({
        id: row.product.id,
        name: row.product.name,
        retailerId: row.product.retailerId,
        price: Number(row.product.price),
        currency: row.product.currency,
        imageUrl: row.product.imageUrl,
        availability: row.product.availability,
        isDraft: row.product.isDraft,
        isPublished: Boolean(row.product.metaProductId),
        sortOrder: row.sortOrder,
      })),
    };
  }
}
