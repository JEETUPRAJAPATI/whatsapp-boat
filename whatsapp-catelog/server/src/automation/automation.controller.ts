import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AutoReplyService } from '../whatsapp/services/auto-reply.service';
import { AutomationService } from './automation.service';
import {
  CreateAutoReplyRuleDto,
  PreviewAutoReplyDto,
  UpdateAutoReplyRuleDto,
} from './dto/automation.dto';

@Controller('api/automation')
export class AutomationController {
  constructor(
    private readonly automation: AutomationService,
    private readonly autoReply: AutoReplyService,
  ) {}

  /** Scheduler state: is sync on, and when does it next run. */
  @Get('status')
  status() {
    return this.automation.status();
  }

  /** Runs the scheduled sync now, across every connected catalog. */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @Post('sync/run')
  async runNow() {
    await this.automation.runScheduledSync();
    return { started: true };
  }

  @Get('auto-reply-rules')
  listRules() {
    return this.automation.listRules();
  }

  @Post('auto-reply-rules')
  createRule(@Body() dto: CreateAutoReplyRuleDto) {
    return this.automation.createRule(dto);
  }

  @Put('auto-reply-rules/:id')
  updateRule(@Param('id') id: string, @Body() dto: UpdateAutoReplyRuleDto) {
    return this.automation.updateRule(id, dto);
  }

  @Delete('auto-reply-rules/:id')
  deleteRule(@Param('id') id: string) {
    return this.automation.deleteRule(id);
  }

  /** Lets a rule fire again immediately for everyone in its cooldown. */
  @HttpCode(200)
  @Post('auto-reply-rules/:id/reset-cooldowns')
  resetCooldowns(@Param('id') id: string) {
    return this.automation.resetCooldowns(id);
  }

  /** Dry run: which rule would answer this message? Sends nothing. */
  @HttpCode(200)
  @Post('auto-reply-rules/preview')
  preview(@Body() dto: PreviewAutoReplyDto) {
    return this.autoReply.preview(dto.text);
  }
}
