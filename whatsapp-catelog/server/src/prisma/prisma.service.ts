import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({ log: ['warn', 'error'] });
  }

  async onModuleInit() {
    try {
      await this.$connect();
      this.logger.log('Database connected');
    } catch (err) {
      // Keep the process alive so the webhook endpoint can still answer Meta's
      // verification handshake while the operator fixes the connection string.
      this.logger.error(`Database connection failed: ${(err as Error).message}`);
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
