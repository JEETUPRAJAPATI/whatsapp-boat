import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard, LOCAL_USER } from './jwt-auth.guard';

@Controller('api/auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Public: lets the UI decide whether to show a sign-in screen at all.
   * Returns no secrets - only whether a token is required.
   */
  @Get('config')
  authConfig() {
    return { authRequired: this.config.get<boolean>('authEnabled') };
  }

  /** Tight rate limit: login is the one unauthenticated write endpoint. */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: { id: string }) {
    if (!this.config.get<boolean>('authEnabled')) return LOCAL_USER;
    return this.auth.me(user.id);
  }
}
