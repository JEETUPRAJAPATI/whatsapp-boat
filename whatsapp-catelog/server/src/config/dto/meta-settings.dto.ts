import { IsOptional, IsString } from 'class-validator';

/**
 * Every field optional and a bare string - these are free-form credential
 * values from Meta's dashboard, not something we can usefully pattern-match.
 * An explicitly empty string on `appSecret`/`accessToken` means "leave the
 * stored secret alone" (see MetaSettingsService.updateSettings).
 */
export class UpdateMetaSettingsDto {
  @IsOptional()
  @IsString()
  appId?: string;

  @IsOptional()
  @IsString()
  appSecret?: string;

  @IsOptional()
  @IsString()
  configId?: string;

  @IsOptional()
  @IsString()
  apiVersion?: string;

  @IsOptional()
  @IsString()
  graphBaseUrl?: string;

  @IsOptional()
  @IsString()
  verifyToken?: string;

  @IsOptional()
  @IsString()
  accessToken?: string;

  @IsOptional()
  @IsString()
  businessId?: string;

  @IsOptional()
  @IsString()
  catalogId?: string;

  @IsOptional()
  @IsString()
  businessName?: string;
}
