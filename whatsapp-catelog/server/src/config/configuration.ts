/**
 * Central place where every environment variable is read and typed.
 *
 * Nothing else in the codebase touches process.env, so there is exactly one
 * file to audit when asking "where do secrets come from".
 */
import * as path from 'path';

export interface MetaConfig {
  appId: string;
  appSecret: string;
  /** Embedded Signup configuration id (App > WhatsApp > Configuration). */
  configId: string;
  apiVersion: string;
  graphBaseUrl: string;
  verifyToken: string;
  /** Fallback token used when a WABA has no encrypted credential of its own. */
  accessToken: string;
  businessId: string;
  wabaId: string;
  phoneNumberId: string;
  catalogId: string;
  businessName: string;
}

export interface AppConfig {
  port: number;
  nodeEnv: string;
  isProduction: boolean;
  clientOrigin: string[];
  publicUrl: string;
  authEnabled: boolean;
  jwtSecret: string;
  jwtExpiresIn: string;
  adminEmail: string;
  adminPassword: string;
  encryptionKey: string;
  webhookLogging: boolean;
  uploadDir: string;
  maxImageBytes: number;
  maxVideoBytes: number;
  syncEnabled: boolean;
  syncCron: string;
  autoReplyEnabled: boolean;
  meta: MetaConfig;
}

const bool = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
};

const int = (value: string | undefined, fallback: number): number => {
  const parsed = parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const stripTrailingSlash = (url: string): string => url.replace(/\/+$/, '');

export default (): AppConfig => {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const port = int(process.env.PORT, 4100);

  return {
    port,
    nodeEnv,
    isProduction: nodeEnv === 'production',
    clientOrigin: (process.env.CLIENT_ORIGIN || 'http://localhost:5174')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    publicUrl: stripTrailingSlash(process.env.APP_PUBLIC_URL || `http://localhost:${port}`),

    // Opt-out, not opt-in: a fresh deployment is protected unless someone
    // deliberately writes AUTH_ENABLED=false.
    authEnabled: bool(process.env.AUTH_ENABLED, true),
    jwtSecret: process.env.JWT_SECRET || '',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '12h',
    adminEmail: process.env.ADMIN_EMAIL || '',
    adminPassword: process.env.ADMIN_PASSWORD || '',
    encryptionKey: process.env.ENCRYPTION_KEY || '',
    webhookLogging: bool(process.env.WEBHOOK_LOGGING, false),

    uploadDir: path.resolve(process.cwd(), process.env.UPLOAD_DIR || '../uploads'),
    maxImageBytes: int(process.env.MAX_IMAGE_MB, 8) * 1024 * 1024,
    maxVideoBytes: int(process.env.MAX_VIDEO_MB, 64) * 1024 * 1024,

    syncEnabled: bool(process.env.CATALOG_SYNC_ENABLED, true),
    syncCron: process.env.CATALOG_SYNC_CRON || '0 30 2 * * *',
    autoReplyEnabled: bool(process.env.AUTO_REPLY_ENABLED, true),

    meta: {
      appId: process.env.META_APP_ID || '',
      appSecret: process.env.META_APP_SECRET || '',
      configId: process.env.META_CONFIG_ID || '',
      // Kept configurable so a Graph version bump is an env change, not a deploy.
      apiVersion: process.env.META_API_VERSION || 'v25.0',
      graphBaseUrl: stripTrailingSlash(
        process.env.META_GRAPH_BASE_URL || 'https://graph.facebook.com',
      ),
      // Both names accepted so an existing meta-whatsapp .env can be reused.
      verifyToken:
        process.env.META_WEBHOOK_VERIFY_TOKEN || process.env.META_WHATSAPP_VERIFY_TOKEN || '',
      accessToken: process.env.META_ACCESS_TOKEN || process.env.META_WHATSAPP_ACCESS_TOKEN || '',
      businessId: process.env.META_BUSINESS_ID || '',
      wabaId: process.env.META_WABA_ID || process.env.META_WHATSAPP_BUSINESS_ACCOUNT_ID || '',
      phoneNumberId:
        process.env.META_PHONE_NUMBER_ID || process.env.META_WHATSAPP_PHONE_NUMBER_ID || '',
      catalogId: process.env.META_CATALOG_ID || '',
      businessName: process.env.META_BUSINESS_NAME || 'My Business',
    },
  };
};
