import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { join } from 'path';
import { AuditModule } from './audit/audit.module';
import { AutomationModule } from './automation/automation.module';
import { CatalogModule } from './catalog/catalog.module';
import { CommonModule } from './common/common.module';
import configuration from './config/configuration';
import { MetaModule } from './meta/meta.module';
import { PrismaModule } from './prisma/prisma.module';
import { StorageModule } from './storage/storage.module';
import { WhatsappModule } from './whatsapp/whatsapp.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    ScheduleModule.forRoot(),

    // Baseline rate limit for every route; individual routes tighten it.
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 300 }]),

    /**
     * Product images are served from here. They must be publicly readable -
     * Meta's crawler downloads them by URL and cannot present a bearer token -
     * so this path is deliberately outside the auth guard. Filenames are
     * random, and nothing but uploaded product media lives in this directory.
     */
    ServeStaticModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          rootPath: config.get<string>('uploadDir'),
          serveRoot: '/media',
          serveStaticOptions: { index: false, maxAge: '7d', fallthrough: false },
        },
        {
          rootPath: join(__dirname, '..', '..', 'client', 'dist'),
          serveRoot: '/',
          exclude: ['/api*', '/media*', '/socket.io*'],
          serveStaticOptions: { index: 'index.html', maxAge: '1h' },
        },
      ],
    }),

    PrismaModule,
    CommonModule,
    StorageModule,
    MetaModule,
    AuditModule,
    WhatsappModule,
    CatalogModule,
    AutomationModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
