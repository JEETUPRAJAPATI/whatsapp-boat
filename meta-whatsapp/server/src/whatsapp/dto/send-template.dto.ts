import { IsArray, IsOptional, IsString, Matches } from 'class-validator';

export class SendTemplateDto {
  @IsString()
  @Matches(/^\+?[1-9]\d{6,17}$/, { message: 'to must be a valid international phone number' })
  to: string;

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
