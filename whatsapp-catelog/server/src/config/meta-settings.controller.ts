import { Body, Controller, Get, HttpCode, Put } from '@nestjs/common';
import { UpdateMetaSettingsDto } from './dto/meta-settings.dto';
import { MetaSettingsService } from './meta-settings.service';

/** Admin screen for the app-level Meta credentials (database-backed, no restart needed). */
@Controller('api/settings/meta')
export class MetaSettingsController {
  constructor(private readonly settings: MetaSettingsService) {}

  @Get()
  get() {
    return this.settings.getAdminView();
  }

  @HttpCode(200)
  @Put()
  update(@Body() dto: UpdateMetaSettingsDto) {
    return this.settings.updateSettings(dto);
  }
}
