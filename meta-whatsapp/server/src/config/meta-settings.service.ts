import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { CryptoService } from '../common/crypto.service';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateMetaSettingsDto } from './dto/meta-settings.dto';

const SINGLETON_ID = 'singleton';

export interface MetaSettings {
  accessToken: string;
  phoneNumberId: string;
  businessAccountId: string;
  apiVersion: string;
  verifyToken: string;
  appSecret: string;
}

export interface MetaSettingsAdminView {
  phoneNumberId: string;
  businessAccountId: string;
  apiVersion: string;
  verifyToken: string;
  hasAccessToken: boolean;
  accessTokenFingerprint: string | null;
  hasAppSecret: boolean;
  appSecretFingerprint: string | null;
  updatedAt: Date | null;
}

/**
 * Single source of truth for Meta WhatsApp Cloud API credentials.
 *
 * This app is single-tenant: there is exactly one set of credentials, held in
 * the `meta_whatsapp_settings` singleton row. On first boot after the table
 * exists, that row is seeded from the current .env values so existing
 * deployments keep working without any manual step. From then on the DB
 * value wins - .env is only a fallback for when the DB is unreachable, so the
 * webhook handshake and app boot never hard-fail on a database outage.
 */
@Injectable()
export class MetaSettingsService implements OnModuleInit {
  private readonly logger = new Logger(MetaSettingsService.name);

  private cache: MetaSettings = {
    accessToken: '',
    phoneNumberId: '',
    businessAccountId: '',
    apiVersion: 'v25.0',
    verifyToken: '',
    appSecret: '',
  };
  private updatedAt: Date | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit() {
    const envMeta = (this.config.get('meta') as MetaSettings | undefined) || this.cache;
    // Fallback in case the DB is unreachable below: boot exactly as before.
    this.cache = { ...envMeta };

    try {
      let row = await this.prisma.metaWhatsappSettings.findUnique({ where: { id: SINGLETON_ID } });

      if (!row) {
        if ((envMeta.accessToken || envMeta.appSecret) && !this.crypto.isReady) {
          this.logger.warn(
            'ENCRYPTION_KEY is not set - seeding meta_whatsapp_settings without the ' +
              '.env access token/app secret (they cannot be encrypted).',
          );
        }

        const data: Prisma.MetaWhatsappSettingsCreateInput = {
          id: SINGLETON_ID,
          phoneNumberId: envMeta.phoneNumberId || '',
          businessAccountId: envMeta.businessAccountId || '',
          apiVersion: envMeta.apiVersion || 'v25.0',
          verifyToken: envMeta.verifyToken || '',
          accessTokenEnc:
            envMeta.accessToken && this.crypto.isReady ? this.crypto.encrypt(envMeta.accessToken) : null,
          appSecretEnc:
            envMeta.appSecret && this.crypto.isReady ? this.crypto.encrypt(envMeta.appSecret) : null,
        };

        row = await this.prisma.metaWhatsappSettings.create({ data });
        this.logger.log('Seeded meta_whatsapp_settings from .env values');
      }

      this.cache = {
        accessToken: (row.accessTokenEnc && this.crypto.decrypt(row.accessTokenEnc)) || '',
        phoneNumberId: row.phoneNumberId || '',
        businessAccountId: row.businessAccountId || '',
        apiVersion: row.apiVersion || 'v25.0',
        verifyToken: row.verifyToken || '',
        appSecret: (row.appSecretEnc && this.crypto.decrypt(row.appSecretEnc)) || '',
      };
      this.updatedAt = row.updatedAt;
      this.logger.log('Meta WhatsApp settings loaded from the database');
    } catch (err) {
      this.logger.warn(
        `Could not load meta_whatsapp_settings from the database, falling back to .env values: ${(err as Error).message}`,
      );
      this.cache = { ...envMeta };
      this.updatedAt = null;
    }
  }

  /** Synchronous - every consumer of Meta credentials reads this cache. */
  getSettings(): MetaSettings {
    return this.cache;
  }

  /** Masked view safe for the browser: secrets never leave as plaintext. */
  async getAdminView(): Promise<MetaSettingsAdminView> {
    return {
      phoneNumberId: this.cache.phoneNumberId,
      businessAccountId: this.cache.businessAccountId,
      apiVersion: this.cache.apiVersion,
      verifyToken: this.cache.verifyToken,
      hasAccessToken: Boolean(this.cache.accessToken),
      accessTokenFingerprint: this.cache.accessToken
        ? CryptoService.fingerprint(this.cache.accessToken)
        : null,
      hasAppSecret: Boolean(this.cache.appSecret),
      appSecretFingerprint: this.cache.appSecret ? CryptoService.fingerprint(this.cache.appSecret) : null,
      updatedAt: this.updatedAt,
    };
  }

  /**
   * Upserts the singleton row. accessToken/appSecret are only overwritten
   * when a real non-empty value is provided - blank or omitted means "keep
   * what's already stored", so the settings screen never has to redisplay
   * (or blank out) a secret to leave it unchanged.
   */
  async updateSettings(dto: UpdateMetaSettingsDto): Promise<MetaSettingsAdminView> {
    const update: Prisma.MetaWhatsappSettingsUpdateInput = {};
    const create: Prisma.MetaWhatsappSettingsCreateInput = {
      id: SINGLETON_ID,
      phoneNumberId: dto.phoneNumberId ?? '',
      businessAccountId: dto.businessAccountId ?? '',
      apiVersion: (dto.apiVersion && dto.apiVersion.trim()) || 'v25.0',
      verifyToken: dto.verifyToken ?? '',
    };

    if (dto.phoneNumberId !== undefined) update.phoneNumberId = dto.phoneNumberId;
    if (dto.businessAccountId !== undefined) update.businessAccountId = dto.businessAccountId;
    if (dto.apiVersion !== undefined && dto.apiVersion.trim()) update.apiVersion = dto.apiVersion.trim();
    if (dto.verifyToken !== undefined) update.verifyToken = dto.verifyToken;

    if (dto.accessToken && dto.accessToken.trim()) {
      if (this.crypto.isReady) {
        const enc = this.crypto.encrypt(dto.accessToken.trim());
        update.accessTokenEnc = enc;
        create.accessTokenEnc = enc;
      } else {
        this.logger.warn('ENCRYPTION_KEY not set - refusing to store a new access token');
      }
    }
    if (dto.appSecret && dto.appSecret.trim()) {
      if (this.crypto.isReady) {
        const enc = this.crypto.encrypt(dto.appSecret.trim());
        update.appSecretEnc = enc;
        create.appSecretEnc = enc;
      } else {
        this.logger.warn('ENCRYPTION_KEY not set - refusing to store a new app secret');
      }
    }

    const row = await this.prisma.metaWhatsappSettings.upsert({
      where: { id: SINGLETON_ID },
      update,
      create,
    });

    this.cache = {
      accessToken: (row.accessTokenEnc && this.crypto.decrypt(row.accessTokenEnc)) || '',
      phoneNumberId: row.phoneNumberId || '',
      businessAccountId: row.businessAccountId || '',
      apiVersion: row.apiVersion || 'v25.0',
      verifyToken: row.verifyToken || '',
      appSecret: (row.appSecretEnc && this.crypto.decrypt(row.appSecretEnc)) || '',
    };
    this.updatedAt = row.updatedAt;

    return this.getAdminView();
  }
}
