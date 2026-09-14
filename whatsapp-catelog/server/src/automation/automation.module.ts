import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { AutomationController } from './automation.controller';
import { AutomationService } from './automation.service';

@Module({
  imports: [CatalogModule, WhatsappModule],
  controllers: [AutomationController],
  providers: [AutomationService],
  exports: [AutomationService],
})
export class AutomationModule {}
