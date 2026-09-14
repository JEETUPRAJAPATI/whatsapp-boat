import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export const MATCH_TYPES = ['exact', 'contains', 'regex'] as const;
export const REPLY_TYPES = ['text', 'catalog', 'product', 'product_list'] as const;

export class CreateAutoReplyRuleDto {
  @IsString()
  @MinLength(1, { message: 'Give the rule a name' })
  @MaxLength(100)
  name: string;

  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  keywords: string[];

  @IsOptional()
  @IsIn(MATCH_TYPES)
  matchType?: (typeof MATCH_TYPES)[number];

  @IsOptional()
  @IsIn(REPLY_TYPES)
  replyType?: (typeof REPLY_TYPES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  replyText?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  productRetailerIds?: string[];

  @IsOptional()
  @IsString()
  collectionId?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  priority?: number;

  /** 0 disables the cooldown entirely. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10080)
  cooldownMinutes?: number;
}

export class UpdateAutoReplyRuleDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  keywords?: string[];

  @IsOptional()
  @IsIn(MATCH_TYPES)
  matchType?: (typeof MATCH_TYPES)[number];

  @IsOptional()
  @IsIn(REPLY_TYPES)
  replyType?: (typeof REPLY_TYPES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  replyText?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  productRetailerIds?: string[];

  @IsOptional()
  @IsString()
  collectionId?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  priority?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10080)
  cooldownMinutes?: number;
}

export class PreviewAutoReplyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  text: string;
}
