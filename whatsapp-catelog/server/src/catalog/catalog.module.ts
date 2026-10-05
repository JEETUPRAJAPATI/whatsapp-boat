import { Module } from '@nestjs/common';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { CatalogFormatController } from './catalog-format.controller';
import { CatalogController } from './catalog.controller';
import { ProductController } from './product.controller';
import { CatalogFormatService } from './services/catalog-format.service';
import { CatalogService } from './services/catalog.service';
import { CategoryService } from './services/category.service';
import { CollectionService } from './services/collection.service';
import { ProductService } from './services/product.service';
import { SyncService } from './services/sync.service';

@Module({
  // Catalogs hang off WhatsApp accounts, so AccountService is needed here.
  imports: [WhatsappModule],
  controllers: [CatalogController, ProductController, CatalogFormatController],
  providers: [CatalogService, ProductService, CategoryService, CollectionService, SyncService, CatalogFormatService],
  exports: [CatalogService, ProductService, SyncService],
})
export class CatalogModule {}
