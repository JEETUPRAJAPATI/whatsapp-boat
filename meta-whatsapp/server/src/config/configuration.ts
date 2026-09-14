/** Central place where every environment variable is read and typed. */
export interface AppConfig {
  port: number;
  nodeEnv: string;
  clientOrigin: string[];
  authEnabled: boolean;
  jwtSecret: string;
  jwtExpiresIn: string;
  adminEmail: string;
  adminPassword: string;
  webhookLogging: boolean;
  meta: {
    accessToken: string;
    phoneNumberId: string;
    businessAccountId: string;
    apiVersion: string;
    verifyToken: string;
    appSecret: string;
  };
}

export default (): AppConfig => ({
  port: parseInt(process.env.PORT || '4000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  clientOrigin: (process.env.CLIENT_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  // Opt-out, not opt-in: a fresh deployment is protected unless someone
  // deliberately writes AUTH_ENABLED=false.
  authEnabled: String(process.env.AUTH_ENABLED || 'true') !== 'false',
  jwtSecret: process.env.JWT_SECRET || '',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '12h',
  adminEmail: process.env.ADMIN_EMAIL || '',
  adminPassword: process.env.ADMIN_PASSWORD || '',
  webhookLogging: String(process.env.WEBHOOK_LOGGING || 'false') === 'true',
  meta: {
    accessToken: process.env.META_WHATSAPP_ACCESS_TOKEN || '',
    phoneNumberId: process.env.META_WHATSAPP_PHONE_NUMBER_ID || '',
    businessAccountId: process.env.META_WHATSAPP_BUSINESS_ACCOUNT_ID || '',
    apiVersion: process.env.META_WHATSAPP_API_VERSION || 'v25.0',
    verifyToken: process.env.META_WHATSAPP_VERIFY_TOKEN || '',
    appSecret: process.env.META_APP_SECRET || '',
  },
});
