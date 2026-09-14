import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class ListConversationsDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(['OPEN', 'PENDING', 'CLOSED'])
  status?: 'OPEN' | 'PENDING' | 'CLOSED';
}

export class ListMessagesDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  /** Id of the oldest message on screen; returns the page before it. */
  @IsOptional()
  @IsString()
  before?: string;
}

export class UpdateConversationDto {
  @IsOptional()
  @IsIn(['OPEN', 'PENDING', 'CLOSED'])
  status?: 'OPEN' | 'PENDING' | 'CLOSED';

  @IsOptional()
  @IsString()
  assignedTo?: string | null;
}
