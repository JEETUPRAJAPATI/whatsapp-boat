import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCategoryDto, UpdateCategoryDto } from '../dto/catalog.dto';

/**
 * Local merchandising taxonomy.
 *
 * Meta's product `category` is only a free-text string, so the real tree lives
 * here and its name is denormalised onto the product when it is published.
 * Categories are scoped to a business, which is what keeps two businesses from
 * seeing each other's taxonomy.
 */
@Injectable()
export class CategoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  static slugify(name: string): string {
    return String(name)
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 80);
  }

  /** The business a category belongs to, defaulting to the only one. */
  private async resolveBusinessId(businessId?: string): Promise<string> {
    if (businessId) {
      const business = await this.prisma.business.findUnique({ where: { id: businessId } });
      if (!business) throw new NotFoundException('Business not found.');
      return business.id;
    }

    const business = await this.prisma.business.findFirst({ orderBy: { createdAt: 'asc' } });
    if (business) return business.id;

    // A fresh install with no connected account still needs somewhere to put
    // categories, so create the implicit local business.
    const created = await this.prisma.business.create({ data: { name: 'My Business' } });
    return created.id;
  }

  async list(businessId?: string) {
    const id = await this.resolveBusinessId(businessId);
    const categories = await this.prisma.category.findMany({
      where: { businessId: id },
      include: { _count: { select: { products: true } } },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });

    return categories.map((category) => ({
      id: category.id,
      name: category.name,
      slug: category.slug,
      description: category.description,
      parentId: category.parentId,
      sortOrder: category.sortOrder,
      productCount: category._count.products,
      createdAt: category.createdAt,
    }));
  }

  /** Same rows, nested - what the sidebar and pickers render. */
  async tree(businessId?: string) {
    const flat = await this.list(businessId);
    const byId = new Map(flat.map((c) => [c.id, { ...c, children: [] as any[] }]));
    const roots: any[] = [];

    for (const category of byId.values()) {
      const parent = category.parentId ? byId.get(category.parentId) : null;
      if (parent) parent.children.push(category);
      else roots.push(category);
    }
    return roots;
  }

  async create(dto: CreateCategoryDto, userEmail?: string, businessId?: string) {
    const id = await this.resolveBusinessId(businessId);
    const slug = CategoryService.slugify(dto.name);

    const clash = await this.prisma.category.findUnique({
      where: { businessId_slug: { businessId: id, slug } },
    });
    if (clash) throw new ConflictException(`A category named "${dto.name}" already exists.`);

    if (dto.parentId) await this.requireCategory(dto.parentId);

    const category = await this.prisma.category.create({
      data: {
        businessId: id,
        name: dto.name,
        slug,
        description: dto.description || null,
        parentId: dto.parentId || null,
        sortOrder: dto.sortOrder ?? 0,
      },
    });

    await this.audit.log({
      userEmail,
      action: 'category.created',
      entity: 'category',
      entityId: category.id,
      message: `Created category "${category.name}"`,
    });
    return category;
  }

  async update(id: string, dto: UpdateCategoryDto, userEmail?: string) {
    const category = await this.requireCategory(id);

    if (dto.parentId) {
      if (dto.parentId === id) {
        throw new BadRequestException('A category cannot be its own parent.');
      }
      await this.assertNotDescendant(id, dto.parentId);
    }

    const data: any = {};
    if (dto.name !== undefined) {
      data.name = dto.name;
      data.slug = CategoryService.slugify(dto.name);
      const clash = await this.prisma.category.findUnique({
        where: { businessId_slug: { businessId: category.businessId, slug: data.slug } },
      });
      if (clash && clash.id !== id) {
        throw new ConflictException(`A category named "${dto.name}" already exists.`);
      }
    }
    if (dto.description !== undefined) data.description = dto.description || null;
    if (dto.parentId !== undefined) data.parentId = dto.parentId || null;
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;

    const updated = await this.prisma.category.update({ where: { id }, data });

    // Products carry the category name to Meta, so a rename means they are
    // out of date until the next push.
    if (dto.name !== undefined) {
      await this.prisma.product.updateMany({
        where: { categoryId: id, isDraft: false },
        data: { metaCategory: updated.name, syncStatus: 'PENDING' },
      });
    }

    await this.audit.log({
      userEmail,
      action: 'category.updated',
      entity: 'category',
      entityId: id,
      message: `Updated category "${updated.name}"`,
    });
    return updated;
  }

  /**
   * Deleting a category never deletes products: they are simply
   * uncategorised, which the schema already does via onDelete: SetNull.
   */
  async remove(id: string, userEmail?: string) {
    const category = await this.requireCategory(id);

    const children = await this.prisma.category.count({ where: { parentId: id } });
    if (children) {
      throw new BadRequestException(
        'This category has sub-categories. Move or delete those first.',
      );
    }

    const productCount = await this.prisma.product.count({ where: { categoryId: id } });
    await this.prisma.category.delete({ where: { id } });

    await this.audit.log({
      userEmail,
      action: 'category.deleted',
      entity: 'category',
      entityId: id,
      message: `Deleted category "${category.name}" (${productCount} products uncategorised)`,
    });
    return { success: true, uncategorisedProducts: productCount };
  }

  async assignProducts(id: string, productIds: string[], userEmail?: string) {
    const category = await this.requireCategory(id);

    const { count } = await this.prisma.product.updateMany({
      where: { id: { in: productIds } },
      data: { categoryId: id, metaCategory: category.name, syncStatus: 'PENDING' },
    });

    await this.audit.log({
      userEmail,
      action: 'category.products_assigned',
      entity: 'category',
      entityId: id,
      message: `Assigned ${count} products to "${category.name}"`,
    });
    return { assigned: count };
  }

  async removeProducts(id: string, productIds: string[], userEmail?: string) {
    await this.requireCategory(id);

    const { count } = await this.prisma.product.updateMany({
      where: { id: { in: productIds }, categoryId: id },
      data: { categoryId: null, metaCategory: null, syncStatus: 'PENDING' },
    });

    await this.audit.log({
      userEmail,
      action: 'category.products_removed',
      entity: 'category',
      entityId: id,
      message: `Removed ${count} products from the category`,
    });
    return { removed: count };
  }

  private async requireCategory(id: string) {
    const category = await this.prisma.category.findUnique({ where: { id } });
    if (!category) throw new NotFoundException('Category not found.');
    return category;
  }

  /** Prevents a re-parent that would create a cycle. */
  private async assertNotDescendant(categoryId: string, candidateParentId: string) {
    let cursor = candidateParentId;
    const seen = new Set<string>();

    while (cursor) {
      if (cursor === categoryId) {
        throw new BadRequestException('That would make the category a descendant of itself.');
      }
      if (seen.has(cursor)) break;
      seen.add(cursor);

      const parent = await this.prisma.category.findUnique({
        where: { id: cursor },
        select: { parentId: true },
      });
      cursor = parent?.parentId;
    }
  }
}
