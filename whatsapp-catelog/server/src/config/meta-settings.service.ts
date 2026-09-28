import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CryptoService } from '../common/crypto.service';
import { PrismaService } from '../prisma/prisma.service';
import { MetaConfig } from './configuration';
import { UpdateMetaSettingsDto } from './dto/meta-settings.dto';

export interface MetaSettingsAdminView {
  appId: string;
  configId: string;
  apiVersion: string;
  graphBaseUrl: string;
  verifyToken: string;
  businessId: string;
  catalogId: string;
  businessName: string;
  hasAppSecret: boolean;
  appSecretFingerprint: string | null;
  hasAccessToken: boolean;
  accessTokenFingerprint: string | null;
  updatedAt: Date | null;
}

const SINGLETON_ID = 'singleton';

/**
 * Source of truth for app-level Meta credentials, backed by the
 * `meta_catalog_settings` table instead of .env.
 *
 * On first boot after the table exists, the row is seeded from whatever is
 * currently in .env, so nothing has to be re-typed. After that, the database
 * always wins - .env is only ever a fallback, used when the database itself
 * cannot be reached (mirrors PrismaService's own "keep the process alive"
 * posture elsewhere in this codebase).
 */
@Injectable()
export class MetaSettingsService implements OnModuleInit {
  private readonly logger = new Logger(MetaSettingsService.name);
  private cache: MetaConfig;
  private lastUpdatedAt: Date | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly config: ConfigService,
  ) {
    // Synchronous fallback so getSettings() is never undefined - NestJS does
    // not guarantee this module's async onModuleInit() finishes before other
    // modules' onModuleInit() hooks call in here (it doesn't: AccountService
    // has crashed on exactly this race). onModuleInit() below overwrites this
    // with DB-backed values once the database read completes.
    this.cache = this.config.get<MetaConfig>('meta');
  }

  async onModuleInit() {
    const envMeta = this.config.get<MetaConfig>('meta');

    try {
      let row = await this.prisma.metaAppSettings.findUnique({ where: { id: SINGLETON_ID } });

      if (!row) {
        const appSecretEnc =
          envMeta.appSecret && this.crypto.isReady ? this.crypto.encrypt(envMeta.appSecret) : null;
        const accessTokenEnc =
          envMeta.accessToken && this.crypto.isReady ? this.crypto.encrypt(envMeta.accessToken) : null;

        if ((envMeta.appSecret && !this.crypto.isReady) || (envMeta.accessToken && !this.crypto.isReady)) {
          this.logger.warn(
            'ENCRYPTION_KEY is not set - seeding meta_catalog_settings without encrypting the ' +
              'app secret / access token from .env. Set ENCRYPTION_KEY so these persist safely.',
          );
        }

        row = await this.prisma.metaAppSettings.create({
          data: {
            id: SINGLETON_ID,
            appId: envMeta.appId,
            appSecretEnc,
            configId: envMeta.configId,
            apiVersion: envMeta.apiVersion,
            graphBaseUrl: envMeta.graphBaseUrl,
            verifyToken: envMeta.verifyToken,
            accessTokenEnc,
            businessId: envMeta.businessId,
            catalogId: envMeta.catalogId,
            businessName: envMeta.businessName,
          },
        });
        this.logger.log('Seeded meta_catalog_settings from environment variables (first boot).');
      }

      this.cache = {
        appId: row.appId,
        appSecret: (row.appSecretEnc && this.crypto.decrypt(row.appSecretEnc)) || '',
        configId: row.configId,
        apiVersion: row.apiVersion,
        graphBaseUrl: row.graphBaseUrl,
        verifyToken: row.verifyToken,
        accessToken: (row.accessTokenEnc && this.crypto.decrypt(row.accessTokenEnc)) || '',
        businessId: row.businessId,
        // Dead fields kept only because MetaConfig is shared with 6 other
        // consumers - the real per-account WABA/phone-number ids live on
        // WhatsappAccount/WhatsappPhoneNumber instead.
        wabaId: '',
        phoneNumberId: '',
        catalogId: row.catalogId,
        businessName: row.businessName,
      };
      this.lastUpdatedAt = row.updatedAt;
      this.logger.log('Meta settings loaded from the database');
    } catch (err) {
      this.logger.warn(
        'Meta settings could not be loaded from the database - falling back to environment ' +
          `variables. (${(err as Error).message})`,
      );
      this.cache = envMeta;
      this.lastUpdatedAt = null;
    }
  }

  /** Synchronous - every existing consumer swaps `config.get('meta')` for this. */
  getSettings(): MetaConfig {
    return this.cache;
  }

  async getAdminView(): Promise<MetaSettingsAdminView> {
    const current = this.cache;
    return {
      appId: current.appId,
      configId: current.configId,
      apiVersion: current.apiVersion,
      graphBaseUrl: current.graphBaseUrl,
      verifyToken: current.verifyToken,
      businessId: current.businessId,
      catalogId: current.catalogId,
      businessName: current.businessName,
      hasAppSecret: Boolean(current.appSecret),
      appSecretFingerprint: current.appSecret ? CryptoService.fingerprint(current.appSecret) : null,
      hasAccessToken: Boolean(current.accessToken),
      accessTokenFingerprint: current.accessToken ? CryptoService.fingerprint(current.accessToken) : null,
      updatedAt: this.lastUpdatedAt,
    };
  }

  async updateSettings(dto: UpdateMetaSettingsDto): Promise<MetaSettingsAdminView> {
    const data: Record<string, unknown> = {};

    if (dto.appId !== undefined) data.appId = dto.appId;
    if (dto.configId !== undefined) data.configId = dto.configId;
    if (dto.apiVersion !== undefined) data.apiVersion = dto.apiVersion;
    if (dto.graphBaseUrl !== undefined) data.graphBaseUrl = dto.graphBaseUrl.replace(/\/+$/, '');
    if (dto.verifyToken !== undefined) data.verifyToken = dto.verifyToken;
    if (dto.businessId !== undefined) data.businessId = dto.businessId;
    if (dto.catalogId !== undefined) data.catalogId = dto.catalogId;
    if (dto.businessName !== undefined) data.businessName = dto.businessName;

    // Blank means "leave the existing secret alone" - the frontend always
    // sends '' rather than omitting the field once a secret is already set.
    if (dto.appSecret) {
      data.appSecretEnc = this.crypto.isReady ? this.crypto.encrypt(dto.appSecret) : null;
    }
    if (dto.accessToken) {
      data.accessTokenEnc = this.crypto.isReady ? this.crypto.encrypt(dto.accessToken) : null;
    }

    const row = await this.prisma.metaAppSettings.upsert({
      where: { id: SINGLETON_ID },
      update: data,
      create: {
        id: SINGLETON_ID,
        appId: dto.appId ?? '',
        appSecretEnc: dto.appSecret && this.crypto.isReady ? this.crypto.encrypt(dto.appSecret) : null,
        configId: dto.configId ?? '',
        apiVersion: dto.apiVersion ?? 'v25.0',
        graphBaseUrl: (dto.graphBaseUrl ?? 'https://graph.facebook.com').replace(/\/+$/, ''),
        verifyToken: dto.verifyToken ?? '',
        accessTokenEnc: dto.accessToken && this.crypto.isReady ? this.crypto.encrypt(dto.accessToken) : null,
        businessId: dto.businessId ?? '',
        catalogId: dto.catalogId ?? '',
        businessName: dto.businessName ?? 'My Business',
      },
    });

    this.cache = {
      appId: row.appId,
      appSecret: (row.appSecretEnc && this.crypto.decrypt(row.appSecretEnc)) || '',
      configId: row.configId,
      apiVersion: row.apiVersion,
      graphBaseUrl: row.graphBaseUrl,
      verifyToken: row.verifyToken,
      accessToken: (row.accessTokenEnc && this.crypto.decrypt(row.accessTokenEnc)) || '',
      businessId: row.businessId,
      wabaId: '',
      phoneNumberId: '',
      catalogId: row.catalogId,
      businessName: row.businessName,
    };
    this.lastUpdatedAt = row.updatedAt;

    return this.getAdminView();
  }
}
