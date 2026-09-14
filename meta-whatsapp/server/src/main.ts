import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Raw body is required to verify Meta's X-Hub-Signature-256 HMAC.
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

  const meta = config.get('meta') as { accessToken: string; verifyToken: string };
  logger.log(`Server listening on http://localhost:${port}`);
  logger.log(`Webhook URL path: /api/whatsapp/webhook`);
  if (!meta.accessToken) {
    logger.warn('META_WHATSAPP_ACCESS_TOKEN is empty - outbound sending is disabled');
  }
  if (!meta.verifyToken) {
    logger.warn('META_WHATSAPP_VERIFY_TOKEN is empty - webhook verification will fail');
  }
  if (!config.get<boolean>('authEnabled')) {
    logger.warn(
      'AUTH_ENABLED=false - the inbox and send endpoints are OPEN. Anyone who can reach ' +
        `port ${port} can read conversations and send WhatsApp messages. Do not expose this publicly.`,
    );
  }
}

bootstrap();
