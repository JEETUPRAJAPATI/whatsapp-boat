import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CryptoService } from '../common/crypto.service';
import { MetaConfig } from '../config/configuration';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Decides which access token signs a given Meta call.
 *
 * Resolution order for a WhatsApp account:
 *   1. the encrypted per-account credential stored at connect time;
 *   2. the META_ACCESS_TOKEN fallback from .env, for an operator who already
 *      runs a number with a System User token and has not gone through
 *      Embedded Signup.
 *
 * Callers receive a bare string and are expected to hand it straight to
 * MetaGraphService. No caller ever persists or logs it.
 */
@Injectable()
export class MetaTokenService {
  private readonly logger = new Logger(MetaTokenService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly config: ConfigService,
  ) {}

  private get meta(): MetaConfig {
    return this.config.get<MetaConfig>('meta');
  }

  get fallbackToken(): string {
    return this.meta.accessToken || '';
  }

  get hasFallbackToken(): boolean {
    return Boolean(this.fallbackToken);
  }

  /**
   * Token for one WhatsApp account row (by our uuid).
   * Throws a 503 with an actionable message when nothing is available.
   */
  async forAccount(whatsappAccountId: string): Promise<string> {
    const credential = await this.prisma.metaCredential.findUnique({
      where: { whatsappAccountId },
    });

    if (credential) {
      if (credential.expiresAt && credential.expiresAt.getTime() < Date.now()) {
        throw new ServiceUnavailableException({
          statusCode: 503,
          message:
            'The stored Meta access token for this account has expired. Reconnect the account ' +
            'from WhatsApp > Connection.',
          code: 'TOKEN_EXPIRED',
        });
      }

      const token = this.crypto.decrypt(credential.accessTokenEnc);
      if (token) return token;

      // Decryption failed - almost always a rotated ENCRYPTION_KEY.
      if (!this.hasFallbackToken) {
        throw new ServiceUnavailableException({
          statusCode: 503,
          message:
            'The stored Meta access token could not be read on this server. Reconnect the ' +
            'account from WhatsApp > Connection.',
          code: 'TOKEN_UNREADABLE',
        });
      }
      this.logger.warn(
        `Stored credential for account ${whatsappAccountId} is unreadable; using META_ACCESS_TOKEN.`,
      );
    }

    if (this.hasFallbackToken) return this.fallbackToken;

    throw new ServiceUnavailableException({
      statusCode: 503,
      message:
        'No Meta access token is available for this WhatsApp account. Connect it from ' +
        'WhatsApp > Connection, or set META_ACCESS_TOKEN on the server.',
      code: 'TOKEN_MISSING',
    });
  }

  /** Token for whichever account owns this catalog. */
  async forCatalog(catalogId: string): Promise<string> {
    const catalog = await this.prisma.catalog.findUnique({
      where: { id: catalogId },
      select: { whatsappAccountId: true },
    });
    if (!catalog) {
      throw new ServiceUnavailableException({
        statusCode: 503,
        message: 'This catalog is no longer linked to a WhatsApp account.',
        code: 'CATALOG_UNLINKED',
      });
    }
    return this.forAccount(catalog.whatsappAccountId);
  }

  /**
   * Token for a user-level operation that is not yet tied to any stored
   * account - discovering businesses during onboarding, for example.
   */
  requireBootstrapToken(): string {
    if (!this.hasFallbackToken) {
      throw new ServiceUnavailableException({
        statusCode: 503,
        message:
          'No Meta access token is configured. Connect an account through Embedded Signup, or ' +
          'set META_ACCESS_TOKEN on the server.',
        code: 'TOKEN_MISSING',
      });
    }
    return this.fallbackToken;
  }

  /** Encrypts and stores (or replaces) the credential for an account. */
  async store(params: {
    whatsappAccountId: string;
    accessToken: string;
    tokenType?: string;
    expiresInSeconds?: number | null;
    scopes?: string[];
  }): Promise<void> {
    const accessTokenEnc = this.crypto.encrypt(params.accessToken);
    const expiresAt =
      params.expiresInSeconds && params.expiresInSeconds > 0
        ? new Date(Date.now() + params.expiresInSeconds * 1000)
        : null;

    await this.prisma.metaCredential.upsert({
      where: { whatsappAccountId: params.whatsappAccountId },
      create: {
        whatsappAccountId: params.whatsappAccountId,
        accessTokenEnc,
        tokenType: params.tokenType || 'business',
        expiresAt,
        scopes: params.scopes || [],
      },
      update: {
        accessTokenEnc,
        tokenType: params.tokenType || 'business',
        expiresAt,
        scopes: params.scopes || [],
      },
    });

    this.logger.log(`Stored encrypted Meta credential for account ${params.whatsappAccountId}`);
  }

  async remove(whatsappAccountId: string): Promise<void> {
    await this.prisma.metaCredential.deleteMany({ where: { whatsappAccountId } });
  }

  /** Non-sensitive summary for the settings screen. */
  async describe(whatsappAccountId: string) {
    const credential = await this.prisma.metaCredential.findUnique({
      where: { whatsappAccountId },
      select: { tokenType: true, expiresAt: true, scopes: true, updatedAt: true },
    });

    if (!credential) {
      return {
        source: this.hasFallbackToken ? ('env' as const) : ('none' as const),
        tokenType: this.hasFallbackToken ? 'system_user' : null,
        expiresAt: null,
        scopes: [] as string[],
        updatedAt: null as Date | null,
      };
    }

    return {
      source: 'database' as const,
      tokenType: credential.tokenType,
      expiresAt: credential.expiresAt,
      scopes: credential.scopes,
      updatedAt: credential.updatedAt,
    };
  }
}
