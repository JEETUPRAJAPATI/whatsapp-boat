import { Body, Controller, Get, HttpCode, Put } from '@nestjs/common';
import { UpdateMetaSettingsDto } from './dto/meta-settings.dto';
import { MetaSettingsService } from './meta-settings.service';

/**
 * Settings screen for the Meta WhatsApp Cloud API credentials. No
 * authentication gate - same as every other endpoint in this app.
 */
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
