import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateCatalogFormatDto } from '../dto/catalog-format.dto';

export interface CatalogFormatView {
  titleTemplate: string;
  descriptionTemplate: string;
  updatedAt: Date | null;
}

const SINGLETON_ID = 'singleton';

/** Must match DEFAULT_CATALOG_FORMATS in the admin frontend (src/utils/catalogFormatTemplates.ts). */
export const DEFAULT_TITLE_TEMPLATE = '{location}, {bhk} {subType} {society}';
/** Keep in sync with DEFAULT_DESCRIPTION_TEMPLATE in the admin frontend (src/utils/catalogFormatTemplates.ts). */
export const DEFAULT_DESCRIPTION_TEMPLATE = [
  '{bhk} {propertyType} {transactionText} {inLocation}.',
  '',
  'Carpet area: {carpetArea}',
  'Built-up area: {builtUpArea}',
  'Plot area: {plotArea}',
  'Bedrooms: {bedrooms}',
  'Bathrooms: {bathrooms}',
  'Balconies: {balconies}',
  'Furnishing: {furnishing}',
  'Facing: {facing}',
  'Floor: {floor}',
  'Parking: {parking}',
  'Possession: {possession}',
  '',
  'Price: {price}',
  'Deposit: {deposit}',
  'Maintenance: {maintenance}',
  'Available from: {availableFrom}',
  'Tenant preference: {tenantPreference}',
  'Price negotiable: {negotiable}',
  'Loan available: {loanAvailable}',
  'Builder: {builder}',
  'Project: {project}',
  'RERA number: {rera}',
].join('\n');

@Injectable()
export class CatalogFormatService {
  constructor(private readonly prisma: PrismaService) {}

  async get(): Promise<CatalogFormatView> {
    const row = await this.prisma.catalogFormatSettings.findUnique({ where: { id: SINGLETON_ID } });
    return {
      titleTemplate: row?.titleTemplate ?? DEFAULT_TITLE_TEMPLATE,
      descriptionTemplate: row?.descriptionTemplate ?? DEFAULT_DESCRIPTION_TEMPLATE,
      updatedAt: row?.updatedAt ?? null,
    };
  }

  async update(dto: UpdateCatalogFormatDto): Promise<CatalogFormatView> {
    await this.prisma.catalogFormatSettings.upsert({
      where: { id: SINGLETON_ID },
      update: { titleTemplate: dto.titleTemplate, descriptionTemplate: dto.descriptionTemplate },
      create: {
        id: SINGLETON_ID,
        titleTemplate: dto.titleTemplate,
        descriptionTemplate: dto.descriptionTemplate,
      },
    });
    return this.get();
  }
}
