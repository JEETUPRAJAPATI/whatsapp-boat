import { Injectable, InternalServerErrorException, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

/**
 * Envelope encryption for the Meta credentials stored in the database.
 *
 * The access token and app secret are the most dangerous things this system
 * stores: a leaked token lets an attacker message every customer as the
 * business. They are therefore AES-256-GCM encrypted with ENCRYPTION_KEY
 * before they touch the database, and decrypted only in the moment a Graph
 * request is signed.
 */
@Injectable()
export class CryptoService implements OnModuleInit {
  private readonly logger = new Logger(CryptoService.name);
  private key: Buffer | null = null;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const raw = this.config.get<string>('encryptionKey');
    if (!raw) {
      this.logger.warn(
        'ENCRYPTION_KEY is not set - Meta credentials saved from the settings screen ' +
          'cannot be stored safely and will be rejected.',
      );
      return;
    }
    this.key = this.deriveKey(raw);
    this.logger.log('Token encryption key loaded');
  }

  get isReady(): boolean {
    return this.key !== null;
  }

  /**
   * Accepts a 64-char hex key, a 44-char base64 key, or any passphrase.
   * A passphrase is stretched with SHA-256 so short values still yield 32 bytes,
   * but hex from `crypto.randomBytes(32)` is what the docs tell operators to use.
   */
  private deriveKey(raw: string): Buffer {
    const trimmed = raw.trim();
    if (/^[0-9a-f]{64}$/i.test(trimmed)) return Buffer.from(trimmed, 'hex');

    const asBase64 = Buffer.from(trimmed, 'base64');
    if (asBase64.length === 32) return asBase64;

    this.logger.warn(
      'ENCRYPTION_KEY is not 32 raw bytes - deriving one by hashing it. ' +
        'Prefer: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
    return crypto.createHash('sha256').update(trimmed).digest();
  }

  private requireKey(): Buffer {
    if (!this.key) {
      throw new InternalServerErrorException(
        'Token storage is not configured on the server. Set ENCRYPTION_KEY and restart.',
      );
    }
    return this.key;
  }

  /** Returns `iv:authTag:ciphertext`, all hex. */
  encrypt(plaintext: string): string {
    const key = this.requireKey();
    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return [iv.toString('hex'), cipher.getAuthTag().toString('hex'), encrypted.toString('hex')].join(
      ':',
    );
  }

  /**
   * Reverses encrypt(). Returns null rather than throwing when the payload is
   * unreadable - that happens when ENCRYPTION_KEY was rotated, and the right
   * response is "reconfigure the credential", not a 500 on every request.
   */
  decrypt(payload: string): string | null {
    if (!payload || !this.key) return null;
    const parts = payload.split(':');
    if (parts.length !== 3) return null;

    try {
      const [ivHex, tagHex, dataHex] = parts;
      const decipher = crypto.createDecipheriv(ALGORITHM, this.key, Buffer.from(ivHex, 'hex'));
      decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
      return Buffer.concat([
        decipher.update(Buffer.from(dataHex, 'hex')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      this.logger.error(
        'Stored Meta credential could not be decrypted. ENCRYPTION_KEY may have changed; ' +
          'the credential must be re-entered on the settings screen.',
      );
      return null;
    }
  }

  /** Last four characters only - safe for logs and the settings screen. */
  static fingerprint(token: string): string {
    if (!token || token.length < 8) return '****';
    return `${'*'.repeat(8)}${token.slice(-4)}`;
  }
}
