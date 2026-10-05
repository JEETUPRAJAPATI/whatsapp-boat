import { Body, Controller, Get, HttpCode, Put } from '@nestjs/common';
import { UpdateCatalogFormatDto } from './dto/catalog-format.dto';
import { CatalogFormatService } from './services/catalog-format.service';

/** Title and description format used when a property is uploaded to the catalog. */
@Controller('api/settings/catalog-format')
export class CatalogFormatController {
  constructor(private readonly formats: CatalogFormatService) {}

  @Get()
  get() {
    return this.formats.get();
  }

  @HttpCode(200)
  @Put()
  update(@Body() dto: UpdateCatalogFormatDto) {
    return this.formats.update(dto);
  }
}
