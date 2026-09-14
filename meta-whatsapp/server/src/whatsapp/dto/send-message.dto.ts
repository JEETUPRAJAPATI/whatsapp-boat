import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class SendMessageDto {
  /** E.164 digits, with or without a leading +. */
  @IsString()
  @Matches(/^\+?[1-9]\d{6,17}$/, { message: 'to must be a valid international phone number' })
  to: string;

  @IsOptional()
  @IsIn(['text'], { message: 'Only "text" is supported by this endpoint' })
  type?: string;

  @IsString()
  @MinLength(1, { message: 'message cannot be empty' })
  @MaxLength(4096, { message: 'WhatsApp text messages are limited to 4096 characters' })
  message: string;

  @IsOptional()
  @IsString()
  conversationId?: string;
}

export class SendMediaDto {
  @IsString()
  @Matches(/^\+?[1-9]\d{6,17}$/, { message: 'to must be a valid international phone number' })
  to: string;

  @IsOptional()
  @IsString()
  @MaxLength(1024, { message: 'Captions are limited to 1024 characters' })
  caption?: string;
}
