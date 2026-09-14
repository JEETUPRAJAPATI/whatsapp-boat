import { ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';

/** Identity used for every request while AUTH_ENABLED=false. */
export const LOCAL_USER = {
  id: 'local-admin',
  email: 'admin@local',
  name: 'Inbox',
  role: 'admin',
};

/**
 * Blocks every admin route unless a valid bearer token is present.
 *
 * With AUTH_ENABLED=false the check is skipped entirely and requests run as
 * LOCAL_USER - convenient for a laptop, but it leaves the inbox and the send
 * endpoints open to anyone who can reach the port, so it must stay off for any
 * deployment that is reachable from the internet.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly config: ConfigService) {
    super();
  }

  canActivate(context: ExecutionContext) {
    if (!this.config.get<boolean>('authEnabled')) {
      context.switchToHttp().getRequest().user = LOCAL_USER;
      return true;
    }
    return super.canActivate(context);
  }
}
