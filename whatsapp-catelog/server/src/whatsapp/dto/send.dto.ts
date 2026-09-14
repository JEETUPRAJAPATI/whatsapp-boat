import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

/** E.164 digits, with or without a leading +. */
const PHONE = /^\+?[1-9]\d{6,17}$/;

class SendBaseDto {
  @IsString()
  @Matches(PHONE, { message: 'to must be a valid international phone number' })
  to: string;

  /** Optional: which connected account sends. Defaults to the default account. */
  @IsOptional()
  @IsString()
  accountId?: string;

  /** Optional: which registered number sends. Wins over accountId. */
  @IsOptional()
  @IsString()
  phoneNumberId?: string;
}

export class SendMessageDto extends SendBaseDto {
  @IsOptional()
  @IsIn(['text'], { message: 'Only "text" is supported by this endpoint' })
  type?: string;

  @IsString()
  @MinLength(1, { message: 'message cannot be empty' })
  @MaxLength(4096, { message: 'WhatsApp text messages are limited to 4096 characters' })
  message: string;
}

export class SendMediaDto extends SendBaseDto {
  @IsOptional()
  @IsString()
  @MaxLength(1024, { message: 'Captions are limited to 1024 characters' })
  caption?: string;
}

export class SendTemplateDto extends SendBaseDto {
  @IsString()
  @Matches(/^[a-z0-9_]+$/, {
    message: 'template_name must be lowercase letters, digits or underscores',
  })
  template_name: string;

  @IsOptional()
  @IsString()
  language?: string;

  /** Raw Meta template components, e.g. body parameters. */
  @IsOptional()
  @IsArray()
  components?: unknown[];
}

export class SendProductDto extends SendBaseDto {
  /** Our SKU. Either this or productId must be given. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  product_retailer_id?: string;

  /** Local product uuid - resolved to its retailer id and catalog. */
  @IsOptional()
  @IsString()
  productId?: string;

  @IsOptional()
  @IsString()
  catalogId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  body?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  footer?: string;

  /** Also send the product photos as WhatsApp media before the product card. */
  @IsOptional()
  @IsBoolean()
  includeMedia?: boolean;
}

export class SendCatalogDto extends SendBaseDto {
  @IsOptional()
  @IsString()
  catalogId?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(1024)
  body: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  footer?: string;

  /** Retailer id of the product shown as the catalog thumbnail. */
  @IsOptional()
  @IsString()
  thumbnail_product_retailer_id?: string;
}

class ProductSectionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(24)
  title: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @IsString({ each: true })
  product_retailer_ids: string[];
}

export class SendProductListDto extends SendBaseDto {
  @IsOptional()
  @IsString()
  catalogId?: string;

  /** Send an entire collection instead of naming sections by hand. */
  @IsOptional()
  @IsString()
  collectionId?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(60)
  header: string;

  @IsString()
  @MinLength(1)
  @MaxLength(1024)
  body: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  footer?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductSectionDto)
  @ArrayMaxSize(10)
  sections?: ProductSectionDto[];
}

export class ListConversationsDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @IsIn(['OPEN', 'PENDING', 'CLOSED'])
  status?: string;
}

export class ListMessagesDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @IsOptional()
  @IsString()
  before?: string;
}

export class UpdateConversationDto {
  @IsOptional()
  @IsIn(['OPEN', 'PENDING', 'CLOSED'])
  status?: string;

  @IsOptional()
  @IsString()
  assignedTo?: string;
}
