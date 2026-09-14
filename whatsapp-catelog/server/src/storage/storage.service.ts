import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface StoredFile {
  storageKey: string;
  url: string;
  mimeType: string;
  sizeBytes: number;
  width?: number;
  height?: number;
}

const IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const VIDEO_TYPES: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/3gpp': '3gp',
  'video/quicktime': 'mov',
};

/** Meta rejects catalog images below this, so we reject them first with a clearer message. */
const MIN_IMAGE_DIMENSION = 500;

/**
 * Local disk storage for product media.
 *
 * Meta's crawler downloads product images from a public URL, so whatever
 * stores them must be publicly reachable - hence APP_PUBLIC_URL. On a laptop
 * that is a tunnel; in production it is the server's own domain or, if you
 * swap this class out, an S3/CDN bucket. Nothing else in the codebase knows
 * where bytes live.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);

  constructor(private readonly config: ConfigService) {}

  private get root(): string {
    return this.config.get<string>('uploadDir');
  }

  private get publicUrl(): string {
    return this.config.get<string>('publicUrl');
  }

  async onModuleInit() {
    await fs.mkdir(path.join(this.root, 'products'), { recursive: true });
    this.logger.log(`Media directory ready at ${this.root}`);

    if (/localhost|127\.0\.0\.1/.test(this.publicUrl)) {
      this.logger.warn(
        `APP_PUBLIC_URL is ${this.publicUrl}. Meta cannot download product images from ` +
          'localhost - publishing a product with an uploaded image will fail until this is a ' +
          'public URL (use a tunnel in development).',
      );
    }
  }

  /** True when Meta could actually fetch what we host. */
  get isPubliclyReachable(): boolean {
    return !/localhost|127\.0\.0\.1|0\.0\.0\.0/.test(this.publicUrl);
  }

  /** Base URL of media this server hosts, so callers can tell ours from theirs. */
  get publicBaseUrl(): string {
    return `${this.publicUrl}/media/`;
  }

  validateImage(file: { mimetype: string; size: number }): void {
    if (!IMAGE_TYPES[file.mimetype]) {
      throw new BadRequestException(
        'Unsupported image format. Use JPG, PNG or WebP - the formats Meta accepts for catalog items.',
      );
    }
    const max = this.config.get<number>('maxImageBytes');
    if (file.size > max) {
      throw new BadRequestException(
        `Image is too large. The limit is ${Math.round(max / (1024 * 1024))} MB.`,
      );
    }
  }

  validateVideo(file: { mimetype: string; size: number }): void {
    if (!VIDEO_TYPES[file.mimetype]) {
      throw new BadRequestException('Unsupported video format. Use MP4, MOV or 3GP.');
    }
    const max = this.config.get<number>('maxVideoBytes');
    if (file.size > max) {
      throw new BadRequestException(
        `Video is too large. The limit is ${Math.round(max / (1024 * 1024))} MB.`,
      );
    }
  }

  /**
   * Reads width/height straight out of the file header.
   *
   * Doing it by hand avoids pulling in a native image library for what is
   * ultimately one validation rule, and it only needs to understand the three
   * formats validateImage() already allows.
   */
  static readImageDimensions(
    buffer: Buffer,
    mimeType: string,
  ): { width: number; height: number } | null {
    try {
      if (mimeType === 'image/png') {
        // IHDR width/height live at fixed offsets in every PNG.
        if (buffer.length < 24 || buffer.readUInt32BE(0) !== 0x89504e47) return null;
        return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
      }

      if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') {
        // Walk the marker chain to the SOFn frame header.
        let offset = 2;
        while (offset < buffer.length - 9) {
          if (buffer[offset] !== 0xff) {
            offset += 1;
            continue;
          }
          const marker = buffer[offset + 1];
          const isFrameHeader =
            marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
          if (isFrameHeader) {
            return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
          }
          offset += 2 + buffer.readUInt16BE(offset + 2);
        }
        return null;
      }

      if (mimeType === 'image/webp') {
        if (buffer.length < 30 || buffer.toString('ascii', 8, 12) !== 'WEBP') return null;
        const format = buffer.toString('ascii', 12, 16);
        if (format === 'VP8X') {
          return {
            width: 1 + buffer.readUIntLE(24, 3),
            height: 1 + buffer.readUIntLE(27, 3),
          };
        }
        if (format === 'VP8 ') {
          return {
            width: buffer.readUInt16LE(26) & 0x3fff,
            height: buffer.readUInt16LE(28) & 0x3fff,
          };
        }
        if (format === 'VP8L') {
          const bits = buffer.readUInt32LE(21);
          return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
        }
      }
    } catch {
      // A header we cannot parse is not a reason to reject the upload.
    }
    return null;
  }

  async saveProductImage(
    productId: string,
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
  ): Promise<StoredFile> {
    this.validateImage(file);

    const dimensions = StorageService.readImageDimensions(file.buffer, file.mimetype);
    if (dimensions && (dimensions.width < MIN_IMAGE_DIMENSION || dimensions.height < MIN_IMAGE_DIMENSION)) {
      throw new BadRequestException(
        `Image is ${dimensions.width}x${dimensions.height}. Meta requires catalog images to be ` +
          `at least ${MIN_IMAGE_DIMENSION}x${MIN_IMAGE_DIMENSION}.`,
      );
    }

    const stored = await this.write(productId, file, IMAGE_TYPES[file.mimetype]);
    return { ...stored, width: dimensions?.width, height: dimensions?.height };
  }

  async saveProductVideo(
    productId: string,
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
  ): Promise<StoredFile> {
    this.validateVideo(file);
    return this.write(productId, file, VIDEO_TYPES[file.mimetype]);
  }

  private async write(
    productId: string,
    file: { buffer: Buffer; mimetype: string; size: number },
    extension: string,
  ): Promise<StoredFile> {
    const name = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${extension}`;
    const storageKey = path.posix.join('products', productId, name);
    const absolute = path.join(this.root, storageKey);

    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, file.buffer);

    return {
      storageKey,
      url: `${this.publicUrl}/media/${storageKey}`,
      mimeType: file.mimetype,
      sizeBytes: file.size,
    };
  }

  /** Best-effort delete: a missing file must not fail the API call. */
  async remove(storageKey: string | null | undefined): Promise<void> {
    if (!storageKey) return;
    // Refuse anything that tries to climb out of the upload root.
    const absolute = path.resolve(this.root, storageKey);
    if (!absolute.startsWith(path.resolve(this.root))) {
      this.logger.warn(`Refused to delete outside the upload root: ${storageKey}`);
      return;
    }
    try {
      await fs.unlink(absolute);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.warn(`Could not delete ${storageKey}: ${(err as Error).message}`);
      }
    }
  }

  async removeProductFolder(productId: string): Promise<void> {
    try {
      await fs.rm(path.join(this.root, 'products', productId), { recursive: true, force: true });
    } catch (err) {
      this.logger.warn(`Could not remove media folder for ${productId}: ${(err as Error).message}`);
    }
  }
}
