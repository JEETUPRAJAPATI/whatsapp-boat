import { IsString, MaxLength } from 'class-validator';

/** Both templates are free text with {placeholder} tokens, so only length is checked here. */
export class UpdateCatalogFormatDto {
  @IsString()
  @MaxLength(300)
  titleTemplate!: string;

  @IsString()
  @MaxLength(2000)
  descriptionTemplate!: string;
}
