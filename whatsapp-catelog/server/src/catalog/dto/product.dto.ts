import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export const AVAILABILITY = [
  'IN_STOCK',
  'OUT_OF_STOCK',
  'PREORDER',
  'AVAILABLE_FOR_ORDER',
  'DISCONTINUED',
] as const;

export const CONDITION = ['NEW', 'REFURBISHED', 'USED'] as const;

const toBool = ({ value }: { value: unknown }) => {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
};

export class CreateProductDto {
  /** Which catalog to publish into. Defaults to the default catalog. */
  @IsOptional()
  @IsString()
  catalogId?: string;

  /**
   * SKU. Immutable at Meta once published, so it is generated from the name
   * when the operator does not supply one.
   */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(/^[A-Za-z0-9._-]+$/, {
    message: 'retailerId may contain only letters, digits, dots, dashes and underscores',
  })
  retailerId?: string;

  @IsString()
  @MinLength(1, { message: 'Product name is required' })
  @MaxLength(200, { message: 'Meta limits product names to 200 characters' })
  name: string;

  @IsString()
  @MinLength(1, { message: 'Description is required' })
  @MaxLength(9999, { message: 'Meta limits descriptions to 9999 characters' })
  description: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Price must be a number with at most 2 decimals' })
  @Min(0, { message: 'Price cannot be negative' })
  price: number;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z]{3}$/, { message: 'Currency must be a 3-letter ISO code, e.g. INR' })
  currency?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  salePrice?: number;

  @IsOptional()
  @IsISO8601()
  salePriceStartsAt?: string;

  @IsOptional()
  @IsISO8601()
  salePriceEndsAt?: string;

  @IsOptional()
  @IsIn(AVAILABILITY)
  availability?: (typeof AVAILABILITY)[number];

  @IsOptional()
  @IsIn(CONDITION)
  condition?: (typeof CONDITION)[number];

  @IsOptional()
  @IsString()
  @MaxLength(100)
  brand?: string;

  @IsOptional()
  @IsUrl({ require_tld: false }, { message: 'Product URL must be a valid URL' })
  @MaxLength(2000)
  url?: string;

  /**
   * Main image, when it is already hosted somewhere public (your website, a
   * CDN). An alternative to uploading — Meta only ever needs a URL it can
   * fetch, and re-uploading images a business already hosts is wasted work.
   * Uploading an image later overrides this.
   */
  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'] }, { message: 'Image URL must be a valid public URL' })
  @MaxLength(2000)
  imageUrl?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  /** Vertical-specific attributes: property type, bedrooms, area, and so on. */
  @IsOptional()
  @IsObject()
  customFields?: Record<string, unknown>;

  /** False publishes to Meta; true keeps the product local. */
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  isDraft?: boolean;

  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(9999)
  description?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  price?: number;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z]{3}$/)
  currency?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  salePrice?: number | null;

  @IsOptional()
  @IsISO8601()
  salePriceStartsAt?: string;

  @IsOptional()
  @IsISO8601()
  salePriceEndsAt?: string;

  @IsOptional()
  @IsIn(AVAILABILITY)
  availability?: (typeof AVAILABILITY)[number];

  @IsOptional()
  @IsIn(CONDITION)
  condition?: (typeof CONDITION)[number];

  @IsOptional()
  @IsString()
  @MaxLength(100)
  brand?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  @MaxLength(2000)
  url?: string;

  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'] }, { message: 'Image URL must be a valid public URL' })
  @MaxLength(2000)
  imageUrl?: string;

  @IsOptional()
  @IsString()
  categoryId?: string | null;

  @IsOptional()
  @IsObject()
  customFields?: Record<string, unknown>;

  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  isActive?: boolean;
}

export class ListProductsDto {
  @IsOptional()
  @IsString()
  catalogId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  collectionId?: string;

  @IsOptional()
  @IsIn(AVAILABILITY)
  availability?: string;

  @IsOptional()
  @IsIn(['SYNCED', 'PENDING', 'FAILED', 'CONFLICT'])
  syncStatus?: string;

  /** draft | published | all */
  @IsOptional()
  @IsIn(['draft', 'published', 'all'])
  state?: string;

  @IsOptional()
  @IsIn(['name', 'price', 'createdAt', 'updatedAt'])
  sortBy?: string;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDir?: 'asc' | 'desc';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

export class BulkProductActionDto {
  @IsArray()
  @IsString({ each: true })
  productIds: string[];

  @IsIn(['publish', 'delete', 'activate', 'deactivate', 'in_stock', 'out_of_stock'])
  action: string;
}

export class SetPrimaryImageDto {
  @IsString()
  mediaId: string;
}
