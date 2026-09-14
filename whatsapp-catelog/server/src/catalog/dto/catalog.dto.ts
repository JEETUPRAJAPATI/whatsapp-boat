import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNumberString,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateCategoryDto {
  @IsString()
  @MinLength(1, { message: 'Category name is required' })
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsString()
  parentId?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class UpdateCategoryDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsString()
  parentId?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class AssignProductsDto {
  @IsArray()
  @IsString({ each: true })
  productIds: string[];
}

export class CreateCollectionDto {
  @IsOptional()
  @IsString()
  catalogId?: string;

  @IsString()
  @MinLength(1, { message: 'Collection name is required' })
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  productIds?: string[];

  /**
   * Raw Meta product-set filter. When omitted the collection is hand-picked
   * and the filter is generated from its products.
   */
  @IsOptional()
  @IsObject()
  filter?: Record<string, unknown>;

  /** Push to Meta as a product set immediately. */
  @IsOptional()
  @IsBoolean()
  publish?: boolean;
}

export class UpdateCollectionDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  productIds?: string[];

  @IsOptional()
  @IsObject()
  filter?: Record<string, unknown>;
}

export class ConnectCatalogDto {
  @IsString()
  accountId: string;

  @IsNumberString({}, { message: 'metaCatalogId must be a Meta object id' })
  metaCatalogId: string;
}

export class CreateCatalogDto {
  @IsString()
  accountId: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsString()
  vertical?: string;
}

export class SyncCatalogDto {
  @IsOptional()
  @IsString()
  catalogId?: string;

  /**
   * Push local pending changes to Meta as well as pulling.
   * Off by default: a pull is safe, a push writes to the live catalog.
   */
  @IsOptional()
  @IsBoolean()
  push?: boolean;
}
