import { IsBoolean, IsIn, IsNumberString, IsOptional, IsString, Length, Matches } from 'class-validator';

export class EmbeddedSignupDto {
  /** Short-lived code from the Meta onboarding window. */
  @IsString()
  @Length(1, 2048)
  code: string;

  @IsOptional()
  @IsNumberString({}, { message: 'waba_id must be a Meta object id' })
  waba_id?: string;

  @IsOptional()
  @IsNumberString({}, { message: 'phone_number_id must be a Meta object id' })
  phone_number_id?: string;

  @IsOptional()
  @IsNumberString({}, { message: 'business_id must be a Meta object id' })
  business_id?: string;
}

export class ConnectAccountDto {
  @IsNumberString({}, { message: 'wabaId must be a Meta object id' })
  wabaId: string;

  @IsOptional()
  @IsNumberString({}, { message: 'businessId must be a Meta object id' })
  businessId?: string;

  @IsOptional()
  @IsBoolean()
  makeDefault?: boolean;
}

export class RequestCodeDto {
  @IsNumberString()
  phoneNumberId: string;

  @IsOptional()
  @IsIn(['SMS', 'VOICE'])
  codeMethod?: 'SMS' | 'VOICE';
}

export class VerifyCodeDto {
  @IsNumberString()
  phoneNumberId: string;

  @IsString()
  @Matches(/^\d{3,10}$/, { message: 'The verification code must be digits' })
  code: string;
}

export class RegisterNumberDto {
  @IsNumberString()
  phoneNumberId: string;

  /** Meta's two-step verification PIN. */
  @IsString()
  @Matches(/^\d{6}$/, { message: 'The two-step verification PIN must be exactly 6 digits' })
  pin: string;
}

export class CommerceSettingsDto {
  @IsNumberString()
  phoneNumberId: string;

  @IsOptional()
  @IsBoolean()
  isCatalogVisible?: boolean;

  @IsOptional()
  @IsBoolean()
  isCartEnabled?: boolean;
}
