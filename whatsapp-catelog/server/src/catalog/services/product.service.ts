import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { MediaKind, Prisma, Product, SyncStatus } from '@prisma/client';
import { AuditService } from '../../audit/audit.service';
import { CatalogProductInput, MetaCatalogService } from '../../meta/meta-catalog.service';
import { MetaTokenService } from '../../meta/meta-token.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { CreateProductDto, ListProductsDto, UpdateProductDto } from '../dto/product.dto';
import { CatalogService } from './catalog.service';

const PRODUCT_INCLUDE = {
  category: { select: { id: true, name: true, slug: true } },
  media: { orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }] },
  catalog: { select: { id: true, name: true, metaCatalogId: true, currency: true } },
  collections: { select: { collectionId: true } },
} satisfies Prisma.ProductInclude;

type ProductWithRelations = Prisma.ProductGetPayload<{ include: typeof PRODUCT_INCLUDE }>;

/**
 * Product CRUD, local and at Meta.
 *
 * The rule that shapes this whole file: the local database and the Meta
 * catalog must never silently disagree. A product that failed to publish is
 * marked FAILED with the reason rather than looking published; a delete that
 * Meta refused does not remove the local row.
 */
@Injectable()
export class ProductService {
  private readonly logger = new Logger(ProductService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalogs: CatalogService,
    private readonly metaCatalog: MetaCatalogService,
    private readonly tokens: MetaTokenService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  // -----------------------------------------------------------------------
  // Read
  // -----------------------------------------------------------------------

  async list(query: ListProductsDto) {
    const catalog = await this.catalogs.resolve(query.catalogId);
    const page = Math.max(1, query.page || 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize || 20));

    const where: Prisma.ProductWhereInput = { catalogId: catalog.id, deletedAt: null };

    if (query.search?.trim()) {
      const q = query.search.trim();
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        { retailerId: { contains: q, mode: 'insensitive' } },
        { brand: { contains: q, mode: 'insensitive' } },
      ];
    }
    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.availability) where.availability = query.availability as any;
    if (query.syncStatus) where.syncStatus = query.syncStatus as SyncStatus;
    if (query.state === 'draft') where.isDraft = true;
    if (query.state === 'published') where.isDraft = false;
    if (query.collectionId) {
      where.collections = { some: { collectionId: query.collectionId } };
    }

    const sortBy = query.sortBy || 'updatedAt';
    const sortDir = query.sortDir || 'desc';

    const [items, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        include: PRODUCT_INCLUDE,
        orderBy: { [sortBy]: sortDir },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.product.count({ where }),
    ]);

    return {
      items: items.map((p) => ProductService.serialize(p)),
      total,
      page,
      pageSize,
      pages: Math.ceil(total / pageSize) || 1,
      catalog: { id: catalog.id, name: catalog.name, currency: catalog.currency },
    };
  }

  async findOne(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: PRODUCT_INCLUDE,
    });
    if (!product || product.deletedAt) throw new NotFoundException('Product not found.');
    return ProductService.serialize(product);
  }

  private async requireProduct(id: string): Promise<ProductWithRelations> {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: PRODUCT_INCLUDE,
    });
    if (!product || product.deletedAt) throw new NotFoundException('Product not found.');
    return product;
  }

  // -----------------------------------------------------------------------
  // Create
  // -----------------------------------------------------------------------

  /**
   * Builds a SKU from the product name.
   *
   * Meta treats retailer_id as immutable, so this only ever runs once per
   * product and a short random suffix keeps two identically-named listings
   * from colliding.
   */
  static generateRetailerId(name: string): string {
    const slug = String(name)
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 32);
    const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `${slug || 'ITEM'}-${suffix}`;
  }

  async create(dto: CreateProductDto, userEmail?: string) {
    const catalog = await this.catalogs.resolve(dto.catalogId);
    const retailerId = dto.retailerId || ProductService.generateRetailerId(dto.name);

    const clash = await this.prisma.product.findUnique({
      where: { catalogId_retailerId: { catalogId: catalog.id, retailerId } },
    });
    if (clash) {
      throw new ConflictException(`A product with the SKU "${retailerId}" already exists.`);
    }

    const category = dto.categoryId ? await this.requireCategory(dto.categoryId) : null;
    const realEstateFields = ProductService.extractRealEstateFields(dto);
    const customFields =
      dto.customFields !== undefined || Object.keys(realEstateFields).length
        ? { ...realEstateFields, ...(dto.customFields ?? {}) }
        : undefined;

    let product: ProductWithRelations;
    try {
      product = await this.prisma.product.create({
        data: {
          catalogId: catalog.id,
          retailerId,
          name: dto.name,
          description: dto.description,
          price: new Prisma.Decimal(dto.price),
          currency: (dto.currency || catalog.currency || 'INR').toUpperCase(),
          salePrice: dto.salePrice != null ? new Prisma.Decimal(dto.salePrice) : null,
          salePriceStartsAt: dto.salePriceStartsAt ? new Date(dto.salePriceStartsAt) : null,
          salePriceEndsAt: dto.salePriceEndsAt ? new Date(dto.salePriceEndsAt) : null,
          availability: (dto.availability || 'IN_STOCK') as any,
          condition: (dto.condition || 'NEW') as any,
          brand: dto.brand || null,
          url: dto.url || null,
          categoryId: category?.id || null,
          metaCategory: category?.name || null,
          imageUrl: dto.imageUrl || null,
          customFields: (customFields ?? undefined) as Prisma.InputJsonValue,
          // Everything starts as a draft; publishing is a deliberate second step
          // so a half-finished listing never reaches customers.
          isDraft: dto.isDraft !== false,
          isActive: dto.isActive !== false,
          syncStatus: SyncStatus.PENDING,
          createdBy: userEmail || null,
        },
        include: PRODUCT_INCLUDE,
      });
    } catch (err) {
      // The findUnique check above has a race window - two requests for the
      // same catalog+retailerId (e.g. an aliased duplicate target) can both
      // pass it and collide here. Report it the same way as the pre-check
      // instead of letting a raw Prisma unique-constraint error surface.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(`A product with the SKU "${retailerId}" already exists.`);
      }
      throw err;
    }

    // Multiple images / a video, given as public URLs (e.g. from a property
    // management system's own CDN) rather than uploaded as files.
    await this.applyUrlMedia(product.id, dto.imageUrls, dto.videoUrl);

    await this.audit.log({
      userEmail,
      action: 'product.created',
      entity: 'product',
      entityId: product.id,
      message: `Created "${product.name}" (${retailerId})`,
    });

    // isDraft:false on create means "save and publish in one go".
    if (dto.isDraft === false) return this.publish(product.id, userEmail);

    return this.findOne(product.id);
  }

  // -----------------------------------------------------------------------
  // Update
  // -----------------------------------------------------------------------

  async update(id: string, dto: UpdateProductDto, userEmail?: string) {
    const existing = await this.requireProduct(id);
    const category =
      dto.categoryId === undefined
        ? undefined
        : dto.categoryId
          ? await this.requireCategory(dto.categoryId)
          : null;

    const data: Prisma.ProductUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.price !== undefined) data.price = new Prisma.Decimal(dto.price);
    if (dto.currency !== undefined) data.currency = dto.currency.toUpperCase();
    if (dto.salePrice !== undefined) {
      data.salePrice = dto.salePrice === null ? null : new Prisma.Decimal(dto.salePrice);
    }
    if (dto.salePriceStartsAt !== undefined) {
      data.salePriceStartsAt = dto.salePriceStartsAt ? new Date(dto.salePriceStartsAt) : null;
    }
    if (dto.salePriceEndsAt !== undefined) {
      data.salePriceEndsAt = dto.salePriceEndsAt ? new Date(dto.salePriceEndsAt) : null;
    }
    if (dto.availability !== undefined) data.availability = dto.availability as any;
    if (dto.condition !== undefined) data.condition = dto.condition as any;
    if (dto.brand !== undefined) data.brand = dto.brand || null;
    if (dto.url !== undefined) data.url = dto.url || null;
    // When `imageUrls` is also given, it is the source of truth for the
    // primary image - applyUrlMedia() below sets Product.imageUrl from it.
    if (dto.imageUrl !== undefined && dto.imageUrls === undefined) data.imageUrl = dto.imageUrl || null;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    const realEstateFields = ProductService.extractRealEstateFields(dto);
    if (dto.customFields !== undefined || Object.keys(realEstateFields).length) {
      data.customFields = {
        ...((existing.customFields as Record<string, unknown>) || {}),
        ...realEstateFields,
        ...(dto.customFields ?? {}),
      } as Prisma.InputJsonValue;
    }
    if (category !== undefined) {
      data.category = category ? { connect: { id: category.id } } : { disconnect: true };
      data.metaCategory = category?.name || null;
    }

    // A published product with local edits is out of sync until it is pushed.
    if (!existing.isDraft) data.syncStatus = SyncStatus.PENDING;

    const updated = await this.prisma.product.update({
      where: { id },
      data,
      include: PRODUCT_INCLUDE,
    });

    const mediaChanged = dto.imageUrls !== undefined || dto.videoUrl !== undefined;
    if (mediaChanged) {
      await this.applyUrlMedia(id, dto.imageUrls, dto.videoUrl);
    }

    await this.audit.log({
      userEmail,
      action: 'product.updated',
      entity: 'product',
      entityId: id,
      message: `Updated "${updated.name}"`,
    });

    const final = mediaChanged ? await this.requireProduct(id) : updated;

    // Keep Meta in step automatically for anything meant to be live - including
    // a product that was marked non-draft but never actually made it to Meta
    // (e.g. its first publish failed for missing a field that has since been
    // filled in). `metaProductId` alone is not a reliable "already synced"
    // signal, so this retries through publish() instead of assuming success.
    if (!final.isDraft) {
      return this.publish(final.id, userEmail);
    }
    return ProductService.serialize(final);
  }

  // -----------------------------------------------------------------------
  // Publish / push
  // -----------------------------------------------------------------------

  async publish(id: string, userEmail?: string) {
    const product = await this.requireProduct(id);
    this.assertPublishable(product);
    return this.pushToMeta(product, userEmail);
  }

  /**
   * Refuses a publish that Meta would reject anyway, with a message that says
   * what to fix rather than echoing a Graph error code.
   */
  private assertPublishable(product: ProductWithRelations) {
    const problems: string[] = [];

    if (!product.imageUrl && !product.media.some((m) => m.kind === MediaKind.IMAGE)) {
      problems.push('at least one product image');
    }
    if (Number(product.price) <= 0) {
      problems.push('a price greater than zero');
    }
    if (!product.description?.trim()) {
      problems.push('a description');
    }
    if (problems.length) {
      throw new BadRequestException({
        statusCode: 400,
        message: `This product cannot be published yet. It needs ${problems.join(', ')}.`,
        code: 'PRODUCT_INCOMPLETE',
      });
    }

    // Images we host are only usable if Meta's crawler can actually reach this
    // server. An externally-hosted image URL is unaffected by that, so only
    // block when the product is actually relying on our own storage.
    const usesOwnStorage =
      product.media.some((m) => m.kind === MediaKind.IMAGE) &&
      !ProductService.isExternalUrl(product.imageUrl, this.storage.publicBaseUrl);

    if (usesOwnStorage && !this.storage.isPubliclyReachable) {
      throw new BadRequestException({
        statusCode: 400,
        message:
          'Product images are hosted on a localhost URL, which Meta cannot download. Set ' +
          'APP_PUBLIC_URL to a public address (a tunnel in development), or give the product an ' +
          'image URL that is already public.',
        code: 'IMAGES_NOT_PUBLIC',
      });
    }
  }

  /** True when the image lives somewhere other than this server's media store. */
  private static isExternalUrl(url: string | null | undefined, ownBase: string): boolean {
    if (!url) return false;
    return !url.startsWith(ownBase);
  }

  private toMetaInput(product: ProductWithRelations): CatalogProductInput {
    const images = product.media.filter((m) => m.kind === MediaKind.IMAGE);
    const primary = images.find((m) => m.isPrimary) || images[0];

    return {
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
      category: product.metaCategory || product.category?.name || null,
      salePrice: product.salePrice != null ? Number(product.salePrice) : null,
    };
  }

  /** Creates or updates the product at Meta and records the outcome. */
  private async pushToMeta(product: ProductWithRelations, userEmail?: string) {
    const token = await this.tokens.forCatalog(product.catalogId);
    const catalog = await this.prisma.catalog.findUnique({ where: { id: product.catalogId } });
    const input = this.toMetaInput(product);

    try {
      let metaProductId = product.metaProductId;

      if (metaProductId) {
        await this.metaCatalog.updateProduct(token, metaProductId, input);
      } else {
        // The SKU may already exist at Meta from a previous partial publish or
        // an import; adopt it rather than failing on a duplicate.
        const existing = await this.metaCatalog
          .findByRetailerId(token, catalog.metaCatalogId, product.retailerId)
          .catch(() => null);

        if (existing) {
          metaProductId = existing.id;
          await this.metaCatalog.updateProduct(token, metaProductId, input);
        } else {
          const created = await this.metaCatalog.createProduct(token, catalog.metaCatalogId, input);
          metaProductId = created.id;
        }
      }

      const saved = await this.prisma.product.update({
        where: { id: product.id },
        data: {
          metaProductId,
          isDraft: false,
          syncStatus: SyncStatus.SYNCED,
          syncError: null,
          metaErrors: Prisma.DbNull,
          lastSyncedAt: new Date(),
        },
        include: PRODUCT_INCLUDE,
      });

      await this.audit.log({
        userEmail,
        action: 'product.published',
        entity: 'product',
        entityId: product.id,
        message: `Published "${product.name}" to Meta catalog ${catalog.metaCatalogId}`,
        metadata: { metaProductId },
      });

      return ProductService.serialize(saved);
    } catch (err) {
      const message = (err as any)?.response?.message || (err as Error).message;

      await this.prisma.product.update({
        where: { id: product.id },
        data: {
          syncStatus: SyncStatus.FAILED,
          syncError: String(message).slice(0, 500),
          metaErrors: { code: (err as any)?.response?.code || null, message } as Prisma.InputJsonValue,
        },
      });

      await this.audit.logFailure(
        {
          userEmail,
          action: 'product.publish_failed',
          entity: 'product',
          entityId: product.id,
          message: `Publishing "${product.name}" failed`,
        },
        err,
      );

      throw err;
    }
  }

  // -----------------------------------------------------------------------
  // Delete
  // -----------------------------------------------------------------------

  /**
   * Deletes at Meta first, locally second.
   *
   * If Meta refuses, nothing is removed here: a local row that quietly
   * disappears while the item is still live in customers' WhatsApp is far
   * worse than an error message.
   */
  async remove(id: string, userEmail?: string) {
    const product = await this.requireProduct(id);

    if (product.metaProductId) {
      try {
        await this.metaCatalog.deleteProduct(
          await this.tokens.forCatalog(product.catalogId),
          product.metaProductId,
        );
      } catch (err) {
        const status = (err as any)?.status;
        const code = (err as any)?.response?.code;

        // Already gone at Meta: proceed with the local delete.
        const alreadyGone = status === 404 || code === 'OBJECT_NOT_FOUND';
        if (!alreadyGone) {
          await this.prisma.product.update({
            where: { id },
            data: {
              syncStatus: SyncStatus.CONFLICT,
              syncError: `Delete failed at Meta: ${(err as any)?.response?.message || (err as Error).message}`,
            },
          });
          await this.audit.logFailure(
            { userEmail, action: 'product.delete_failed', entity: 'product', entityId: id },
            err,
          );
          throw err;
        }
        this.logger.warn(`Product ${product.retailerId} was already absent at Meta; deleting locally.`);
      }
    }

    // Soft delete keeps the audit trail and any collection history intact.
    await this.prisma.product.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        isActive: false,
        syncStatus: SyncStatus.SYNCED,
        syncError: null,
      },
    });
    await this.storage.removeProductFolder(id);

    await this.audit.log({
      userEmail,
      action: 'product.deleted',
      entity: 'product',
      entityId: id,
      message: `Deleted "${product.name}" (${product.retailerId})`,
    });

    return { success: true };
  }

  // -----------------------------------------------------------------------
  // Bulk actions
  // -----------------------------------------------------------------------

  /**
   * Applies an action to many products, never aborting the batch on one
   * failure - the caller gets a per-product verdict instead.
   */
  async bulk(productIds: string[], action: string, userEmail?: string) {
    const results: Array<{ id: string; ok: boolean; message?: string }> = [];

    for (const id of productIds) {
      try {
        switch (action) {
          case 'publish':
            await this.publish(id, userEmail);
            break;
          case 'delete':
            await this.remove(id, userEmail);
            break;
          case 'activate':
            await this.update(id, { isActive: true }, userEmail);
            break;
          case 'deactivate':
            await this.update(id, { isActive: false }, userEmail);
            break;
          case 'in_stock':
            await this.update(id, { availability: 'IN_STOCK' }, userEmail);
            break;
          case 'out_of_stock':
            await this.update(id, { availability: 'OUT_OF_STOCK' }, userEmail);
            break;
          default:
            throw new BadRequestException(`Unknown bulk action "${action}".`);
        }
        results.push({ id, ok: true });
      } catch (err) {
        results.push({
          id,
          ok: false,
          message: (err as any)?.response?.message || (err as Error).message,
        });
      }
    }

    const failed = results.filter((r) => !r.ok).length;
    await this.audit.log({
      userEmail,
      action: `product.bulk_${action}`,
      entity: 'product',
      result: failed ? 'failure' : 'success',
      message: `${results.length - failed} of ${results.length} succeeded`,
    });

    return { results, succeeded: results.length - failed, failed };
  }

  // -----------------------------------------------------------------------
  // Media
  // -----------------------------------------------------------------------

  async addImage(
    productId: string,
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
    userEmail?: string,
  ) {
    const product = await this.requireProduct(productId);
    const stored = await this.storage.saveProductImage(productId, file);

    const isFirstImage = !product.media.some((m) => m.kind === MediaKind.IMAGE);

    const media = await this.prisma.productMedia.create({
      data: {
        productId,
        kind: MediaKind.IMAGE,
        url: stored.url,
        storageKey: stored.storageKey,
        mimeType: stored.mimeType,
        sizeBytes: stored.sizeBytes,
        width: stored.width,
        height: stored.height,
        isPrimary: isFirstImage,
        sortOrder: product.media.length,
      },
    });

    if (isFirstImage) {
      await this.prisma.product.update({
        where: { id: productId },
        data: { imageUrl: stored.url, syncStatus: SyncStatus.PENDING },
      });
    }

    await this.audit.log({
      userEmail,
      action: 'product.image_added',
      entity: 'product',
      entityId: productId,
    });

    return media;
  }

  async addVideo(
    productId: string,
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
    userEmail?: string,
  ) {
    await this.requireProduct(productId);
    const stored = await this.storage.saveProductVideo(productId, file);

    const media = await this.prisma.productMedia.create({
      data: {
        productId,
        kind: MediaKind.VIDEO,
        url: stored.url,
        storageKey: stored.storageKey,
        mimeType: stored.mimeType,
        sizeBytes: stored.sizeBytes,
      },
    });

    await this.audit.log({
      userEmail,
      action: 'product.video_added',
      entity: 'product',
      entityId: productId,
    });

    return media;
  }

  async setPrimaryImage(productId: string, mediaId: string, userEmail?: string) {
    const product = await this.requireProduct(productId);
    const media = product.media.find((m) => m.id === mediaId);
    if (!media) throw new NotFoundException('That image does not belong to this product.');
    if (media.kind !== MediaKind.IMAGE) {
      throw new BadRequestException('Only an image can be the main product image.');
    }

    await this.prisma.$transaction([
      this.prisma.productMedia.updateMany({
        where: { productId },
        data: { isPrimary: false },
      }),
      this.prisma.productMedia.update({ where: { id: mediaId }, data: { isPrimary: true } }),
      this.prisma.product.update({
        where: { id: productId },
        data: { imageUrl: media.url, syncStatus: SyncStatus.PENDING },
      }),
    ]);

    await this.audit.log({
      userEmail,
      action: 'product.primary_image_set',
      entity: 'product',
      entityId: productId,
    });

    return this.findOne(productId);
  }

  async removeMedia(productId: string, mediaId: string, userEmail?: string) {
    const product = await this.requireProduct(productId);
    const media = product.media.find((m) => m.id === mediaId);
    if (!media) throw new NotFoundException('That file does not belong to this product.');

    await this.prisma.productMedia.delete({ where: { id: mediaId } });
    await this.storage.remove(media.storageKey);

    // Promote another image when the primary one was removed.
    if (media.isPrimary) {
      const next = await this.prisma.productMedia.findFirst({
        where: { productId, kind: MediaKind.IMAGE },
        orderBy: { sortOrder: 'asc' },
      });
      if (next) {
        await this.prisma.productMedia.update({ where: { id: next.id }, data: { isPrimary: true } });
      }
      await this.prisma.product.update({
        where: { id: productId },
        data: { imageUrl: next?.url || null, syncStatus: SyncStatus.PENDING },
      });
    }

    await this.audit.log({
      userEmail,
      action: 'product.media_removed',
      entity: 'product',
      entityId: productId,
    });

    return this.findOne(productId);
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private async requireCategory(categoryId: string) {
    const category = await this.prisma.category.findUnique({ where: { id: categoryId } });
    if (!category) throw new NotFoundException('Category not found.');
    return category;
  }

  /** Picks the typed real-estate attributes off a DTO, dropping empty ones. */
  private static extractRealEstateFields(
    dto: CreateProductDto | UpdateProductDto,
  ): Record<string, unknown> {
    const attrs: Record<string, unknown> = {
      propertyType: dto.propertyType,
      transactionType: dto.transactionType,
      bedrooms: dto.bedrooms,
      bathrooms: dto.bathrooms,
      balconies: dto.balconies,
      furnishingStatus: dto.furnishingStatus,
      possessionStatus: dto.possessionStatus,
      carpetArea: dto.carpetArea,
      builtUpArea: dto.builtUpArea,
      areaSize: dto.areaSize,
      locality: dto.locality,
      city: dto.city,
      state: dto.state,
      society: dto.society,
      builderName: dto.builderName,
    };
    return Object.fromEntries(
      Object.entries(attrs).filter(([, v]) => v !== undefined && v !== null && v !== ''),
    );
  }

  /**
   * Replaces a product's URL-sourced images/video (imageUrls/videoUrl on the
   * DTO) without touching any file the standalone catalog app itself
   * uploaded (those keep a `storageKey`; URL-sourced rows never have one).
   * Leaves Product.imageUrl pointing at whichever image ends up primary.
   */
  private async applyUrlMedia(productId: string, imageUrls: string[] | undefined, videoUrl: string | undefined) {
    if (imageUrls !== undefined) {
      await this.prisma.productMedia.deleteMany({
        where: { productId, kind: MediaKind.IMAGE, storageKey: null },
      });
      await this.prisma.productMedia.updateMany({
        where: { productId, kind: MediaKind.IMAGE },
        data: { isPrimary: false },
      });
      if (imageUrls.length) {
        await this.prisma.productMedia.createMany({
          data: imageUrls.map((url, index) => ({
            productId,
            kind: MediaKind.IMAGE,
            url,
            isPrimary: index === 0,
            sortOrder: index,
          })),
        });
      }

      const primary = await this.prisma.productMedia.findFirst({
        where: { productId, kind: MediaKind.IMAGE, isPrimary: true },
      });
      await this.prisma.product.update({
        where: { id: productId },
        data: { imageUrl: primary?.url || null },
      });
    }

    if (videoUrl !== undefined) {
      await this.prisma.productMedia.deleteMany({
        where: { productId, kind: MediaKind.VIDEO, storageKey: null },
      });
      if (videoUrl) {
        await this.prisma.productMedia.create({
          data: { productId, kind: MediaKind.VIDEO, url: videoUrl },
        });
      }
    }
  }

  /** The single shape the frontend receives for a product. */
  static serialize(product: ProductWithRelations | Product) {
    const full = product as ProductWithRelations;
    return {
      id: product.id,
      catalogId: product.catalogId,
      metaProductId: product.metaProductId,
      retailerId: product.retailerId,
      name: product.name,
      description: product.description,
      price: Number(product.price),
      currency: product.currency,
      salePrice: product.salePrice != null ? Number(product.salePrice) : null,
      salePriceStartsAt: product.salePriceStartsAt,
      salePriceEndsAt: product.salePriceEndsAt,
      availability: product.availability,
      condition: product.condition,
      brand: product.brand,
      url: product.url,
      categoryId: product.categoryId,
      category: full.category || null,
      metaCategory: product.metaCategory,
      imageUrl: product.imageUrl,
      customFields: product.customFields || {},
      isDraft: product.isDraft,
      isActive: product.isActive,
      metaStatus: product.metaStatus,
      syncStatus: product.syncStatus,
      syncError: product.syncError,
      lastSyncedAt: product.lastSyncedAt,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
      media: (full.media || []).map((m) => ({
        id: m.id,
        kind: m.kind,
        url: m.url,
        mimeType: m.mimeType,
        sizeBytes: m.sizeBytes,
        width: m.width,
        height: m.height,
        isPrimary: m.isPrimary,
        sortOrder: m.sortOrder,
      })),
      collectionIds: (full.collections || []).map((c) => c.collectionId),
      catalog: full.catalog || null,
    };
  }
}
