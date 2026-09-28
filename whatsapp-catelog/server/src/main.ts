import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/http-exception.filter';
import { MetaSettingsService } from './config/meta-settings.service';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // The raw body is required to verify Meta's X-Hub-Signature-256 HMAC, so
    // we install our own parsers rather than letting Nest consume the stream.
    rawBody: true,
    bodyParser: false,
  });

  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  app.use(
    json({
      limit: '2mb',
      verify: (req: any, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );
  app.use(urlencoded({ extended: true }));

  app.enableCors({
    origin: config.get<string[]>('clientOrigin'),
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.set('trust proxy', 1);

  const port = config.get<number>('port');
  await app.listen(port, '0.0.0.0');

  // ---------------------------------------------------------------------
  // Startup checks - say clearly what will not work, before it fails
  // ---------------------------------------------------------------------
  const meta = app.get(MetaSettingsService).getSettings();
  const publicUrl = config.get<string>('publicUrl');

  logger.log(`Server listening on http://localhost:${port}`);
  logger.log(`Webhook URL: ${publicUrl}/api/whatsapp/webhook`);
  logger.log(`Graph API version: ${meta.apiVersion}`);

  if (!meta.verifyToken) {
    logger.warn('META_WEBHOOK_VERIFY_TOKEN is empty - the webhook handshake will fail.');
  }
  if (!meta.appSecret) {
    logger.warn(
      'META_APP_SECRET is empty - webhook signatures cannot be verified. Anyone who learns the ' +
        'webhook URL could post fake messages. Set it before going to production.',
    );
  }
  if (!meta.accessToken) {
    logger.warn(
      'META_ACCESS_TOKEN is empty - connect an account through Embedded Signup, or catalog and ' +
        'messaging calls will have no token to use.',
    );
  }
  if (!config.get<string>('encryptionKey')) {
    logger.warn('ENCRYPTION_KEY is empty - Embedded Signup will refuse to store a token.');
  }
  if (/localhost|127\.0\.0\.1/.test(publicUrl)) {
    logger.warn(
      `APP_PUBLIC_URL is ${publicUrl}. Meta cannot fetch product images or deliver webhooks to ` +
        'localhost - use a tunnel (ngrok / cloudflared) for local development.',
    );
  }
}

bootstrap();
