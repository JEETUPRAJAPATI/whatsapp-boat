import { IsOptional, IsString } from 'class-validator';

export class UpdateMetaSettingsDto {
  /** Blank/omitted = keep the existing stored token. */
  @IsOptional()
  @IsString()
  accessToken?: string;

  @IsOptional()
  @IsString()
  phoneNumberId?: string;

  @IsOptional()
  @IsString()
  businessAccountId?: string;

  @IsOptional()
  @IsString()
  apiVersion?: string;

  @IsOptional()
  @IsString()
  verifyToken?: string;

  /** Blank/omitted = keep the existing stored secret. */
  @IsOptional()
  @IsString()
  appSecret?: string;
}
