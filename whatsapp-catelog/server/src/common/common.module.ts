import { Global, Module } from '@nestjs/common';
import { MetaSettingsController } from '../config/meta-settings.controller';
import { MetaSettingsService } from '../config/meta-settings.service';
import { CryptoService } from './crypto.service';

@Global()
@Module({
  controllers: [MetaSettingsController],
  providers: [CryptoService, MetaSettingsService],
  exports: [CryptoService, MetaSettingsService],
})
export class CommonModule {}
