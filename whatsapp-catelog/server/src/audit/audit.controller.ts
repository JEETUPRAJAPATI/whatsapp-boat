import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuditService } from './audit.service';

@UseGuards(JwtAuthGuard)
@Controller('api/audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  list(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('entity') entity?: string,
    @Query('action') action?: string,
    @Query('result') result?: string,
  ) {
    return this.audit.list({
      page: parseInt(page, 10) || 1,
      pageSize: parseInt(pageSize, 10) || 25,
      entity,
      action,
      result,
    });
  }
}
