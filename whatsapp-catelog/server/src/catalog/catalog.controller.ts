import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  AssignProductsDto,
  ConnectCatalogDto,
  CreateCatalogDto,
  CreateCategoryDto,
  CreateCollectionDto,
  SyncCatalogDto,
  UpdateCategoryDto,
  UpdateCollectionDto,
} from './dto/catalog.dto';
import { CatalogService } from './services/catalog.service';
import { CategoryService } from './services/category.service';
import { CollectionService } from './services/collection.service';
import { SyncService } from './services/sync.service';

/**
 * Catalog, category, collection and sync endpoints.
 *
 * Products get their own controller because they carry file uploads; the rest
 * of the catalog surface lives here.
 */
@Controller('api/catalog')
export class CatalogController {
  constructor(
    private readonly catalogs: CatalogService,
    private readonly categories: CategoryService,
    private readonly collections: CollectionService,
    private readonly sync: SyncService,
  ) {}

  // =======================================================================
  // Catalogs
  // =======================================================================

  /** Dashboard counters for one catalog. */
  @Get()
  overview(@Query('catalogId') catalogId?: string) {
    return this.catalogs.overview(catalogId);
  }

  @Get('catalogs')
  list() {
    return this.catalogs.list();
  }

  /** Catalogs visible at Meta, including ones not tracked here yet. */
  @Get('catalogs/discover')
  discover(@Query('accountId') accountId: string) {
    return this.catalogs.discover(accountId);
  }

  @HttpCode(200)
  @Post('catalogs/connect')
  connect(@Body() dto: ConnectCatalogDto) {
    return this.catalogs.connect(dto);
  }

  @Post('catalogs')
  create(@Body() dto: CreateCatalogDto) {
    return this.catalogs.create(dto);
  }

  @HttpCode(200)
  @Post('catalogs/:id/default')
  setDefault(@Param('id') id: string) {
    return this.catalogs.setDefault(id);
  }

  /** Deletes the catalog at Meta - irreversible, takes every product in it with it. */
  @Delete('catalogs/:id')
  remove(@Param('id') id: string) {
    return this.catalogs.remove(id);
  }

  // =======================================================================
  // Sync
  // =======================================================================

  /** Pull from Meta, and optionally push local pending changes back. */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('sync')
  runSync(@Body() dto: SyncCatalogDto) {
    return this.sync.run({
      catalogId: dto.catalogId,
      push: dto.push,
      trigger: 'manual',
    });
  }

  @Get('sync/history')
  syncHistory(@Query('catalogId') catalogId?: string, @Query('limit') limit?: string) {
    return this.catalogs.syncHistory(catalogId, parseInt(limit, 10) || 20);
  }

  @Get('sync/conflicts')
  conflicts(@Query('catalogId') catalogId?: string) {
    return this.sync.conflicts(catalogId);
  }

  @HttpCode(200)
  @Post('sync/conflicts/:productId/resolve')
  resolveConflict(
    @Param('productId') productId: string,
    @Body('resolution') resolution: 'local' | 'meta',
  ) {
    return this.sync.resolveConflict(productId, resolution === 'meta' ? 'meta' : 'local');
  }

  // =======================================================================
  // Categories
  // =======================================================================

  @Get('categories')
  listCategories(@Query('tree') tree?: string, @Query('businessId') businessId?: string) {
    return tree === 'true' ? this.categories.tree(businessId) : this.categories.list(businessId);
  }

  @Post('categories')
  createCategory(@Body() dto: CreateCategoryDto) {
    return this.categories.create(dto);
  }

  @Put('categories/:id')
  updateCategory(@Param('id') id: string, @Body() dto: UpdateCategoryDto) {
    return this.categories.update(id, dto);
  }

  @Delete('categories/:id')
  deleteCategory(@Param('id') id: string) {
    return this.categories.remove(id);
  }

  @HttpCode(200)
  @Post('categories/:id/products')
  assignToCategory(@Param('id') id: string, @Body() dto: AssignProductsDto) {
    return this.categories.assignProducts(id, dto.productIds);
  }

  @HttpCode(200)
  @Post('categories/:id/products/remove')
  removeFromCategory(@Param('id') id: string, @Body() dto: AssignProductsDto) {
    return this.categories.removeProducts(id, dto.productIds);
  }

  // =======================================================================
  // Collections (Meta product sets)
  // =======================================================================

  @Get('collections')
  listCollections(@Query('catalogId') catalogId?: string) {
    return this.collections.list(catalogId);
  }

  @Get('collections/:id')
  getCollection(@Param('id') id: string) {
    return this.collections.findOne(id);
  }

  @Post('collections')
  createCollection(@Body() dto: CreateCollectionDto) {
    return this.collections.create(dto);
  }

  @Put('collections/:id')
  updateCollection(@Param('id') id: string, @Body() dto: UpdateCollectionDto) {
    return this.collections.update(id, dto);
  }

  @Delete('collections/:id')
  deleteCollection(@Param('id') id: string) {
    return this.collections.remove(id);
  }

  @HttpCode(200)
  @Post('collections/:id/publish')
  publishCollection(@Param('id') id: string) {
    return this.collections.publish(id);
  }

  @HttpCode(200)
  @Post('collections/:id/products')
  addToCollection(@Param('id') id: string, @Body() dto: AssignProductsDto) {
    return this.collections.addProducts(id, dto.productIds);
  }

  @HttpCode(200)
  @Post('collections/:id/products/remove')
  removeFromCollection(@Param('id') id: string, @Body() dto: AssignProductsDto) {
    return this.collections.removeProducts(id, dto.productIds);
  }
}
