import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MetaSettingsController } from '../config/meta-settings.controller';
import { MetaSettingsService } from '../config/meta-settings.service';
import { CryptoService } from './crypto.service';

/**
 * Global home for cross-cutting singletons: credential encryption and the
 * DB-backed Meta settings that replace the old .env-only config. Marked
 * @Global so WhatsappModule (and anything else) can inject MetaSettingsService
 * without importing this module explicitly.
 */
@Global()
@Module({
  imports: [PrismaModule],
  controllers: [MetaSettingsController],
  providers: [CryptoService, MetaSettingsService],
  exports: [CryptoService, MetaSettingsService],
})
export class CommonModule {}
