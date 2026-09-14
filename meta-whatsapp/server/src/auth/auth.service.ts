import { Injectable, Logger, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  /** Seeds the admin account from ADMIN_EMAIL/ADMIN_PASSWORD on first boot. */
  async onModuleInit() {
    const email = this.config.get<string>('adminEmail');
    const password = this.config.get<string>('adminPassword');
    if (!email || !password) return;

    try {
      const existing = await this.prisma.adminUser.findUnique({ where: { email } });
      if (existing) return;
      await this.prisma.adminUser.create({
        data: {
          email,
          name: 'Administrator',
          passwordHash: await bcrypt.hash(password, 10),
        },
      });
      this.logger.log(`Seeded admin user ${email}`);
    } catch (err) {
      this.logger.warn(`Could not seed admin user: ${(err as Error).message}`);
    }
  }

  async login(email: string, password: string) {
    const user = await this.prisma.adminUser.findUnique({ where: { email } });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid email or password');
    }
    const payload = { sub: user.id, email: user.email, role: user.role };
    return {
      accessToken: await this.jwt.signAsync(payload),
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    };
  }

  /** Used by both the HTTP guard and the Socket.IO handshake. */
  async verifyToken(token: string) {
    try {
      return await this.jwt.verifyAsync(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  async me(userId: string) {
    const user = await this.prisma.adminUser.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('Account no longer exists');
    return { id: user.id, email: user.email, name: user.name, role: user.role };
  }
}
