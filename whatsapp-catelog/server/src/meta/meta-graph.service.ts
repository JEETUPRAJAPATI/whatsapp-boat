import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance, Method } from 'axios';
import * as crypto from 'crypto';
import FormData from 'form-data';
import { MetaConfig } from '../config/configuration';
import { normalizeMetaError, toHttpException } from './meta-error';

export interface GraphRequest {
  /** Graph path without the version prefix, e.g. `123456/products`. */
  path: string;
  token: string;
  params?: Record<string, unknown>;
  body?: Record<string, unknown>;
  method?: Method;
  /** Used only for log lines and error context. */
  context?: string;
  timeoutMs?: number;
}

export interface GraphPage<T> {
  data: T[];
  paging?: { cursors?: { before?: string; after?: string }; next?: string; previous?: string };
}

/**
 * The single door to graph.facebook.com.
 *
 * Every Meta call in this application goes through here, which is what makes
 * two guarantees checkable rather than hopeful:
 *   1. an access token is only ever an Authorization header - it is never
 *      logged, echoed, or placed in a query string;
 *   2. every Graph failure is normalised before it can reach a controller.
 */
@Injectable()
export class MetaGraphService {
  private readonly logger = new Logger('Meta Graph');
  private readonly http: AxiosInstance;

  constructor(private readonly config: ConfigService) {
    this.http = axios.create({ timeout: 30_000 });
  }

  get meta(): MetaConfig {
    return this.config.get<MetaConfig>('meta');
  }

  get apiVersion(): string {
    return this.meta.apiVersion;
  }

  /** Absolute URL for a versioned Graph path. */
  url(path: string): string {
    const clean = String(path).replace(/^\/+/, '');
    return `${this.meta.graphBaseUrl}/${this.meta.apiVersion}/${clean}`;
  }

  /**
   * appsecret_proof binds a request to our app secret, so a stolen token alone
   * cannot be replayed against Meta from somewhere else. Meta requires it when
   * the app has "Require app secret" enabled and accepts it always.
   */
  private appSecretProof(token: string): string | null {
    const secret = this.meta.appSecret;
    if (!secret || !token) return null;
    // An app token (`APP_ID|APP_SECRET`) is already proof of the secret and
    // Meta rejects a proof alongside it.
    if (token.includes('|')) return null;
    return crypto.createHmac('sha256', secret).update(token).digest('hex');
  }

  private headers(token: string): Record<string, string> {
    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
  }

  private withProof(token: string, params?: Record<string, unknown>) {
    const proof = this.appSecretProof(token);
    return proof ? { ...(params || {}), appsecret_proof: proof } : params;
  }

  async request<T = any>(req: GraphRequest): Promise<T> {
    const method = (req.method || 'GET') as Method;
    const context = req.context || `${method} ${req.path}`;

    try {
      const { data } = await this.http.request<T>({
        method,
        url: this.url(req.path),
        headers: this.headers(req.token),
        params: this.withProof(req.token, req.params),
        data: req.body,
        timeout: req.timeoutMs || 30_000,
      });
      return data;
    } catch (err) {
      const normalized = normalizeMetaError(err, context);
      // Full detail goes to the server log; the client sees only `message`.
      this.logger.error(
        `${context} failed - code=${normalized.metaCode ?? 'n/a'} ` +
          `subcode=${normalized.metaSubcode ?? 'n/a'} ${normalized.detail}`,
      );
      throw toHttpException(normalized);
    }
  }

  get<T = any>(path: string, token: string, params?: Record<string, unknown>, context?: string) {
    return this.request<T>({ path, token, params, method: 'GET', context });
  }

  post<T = any>(path: string, token: string, body?: Record<string, unknown>, context?: string) {
    return this.request<T>({ path, token, body, method: 'POST', context });
  }

  delete<T = any>(path: string, token: string, params?: Record<string, unknown>, context?: string) {
    return this.request<T>({ path, token, params, method: 'DELETE', context });
  }

  /**
   * Follows Graph cursor pagination to the end.
   *
   * `maxPages` is a deliberate safety valve: a catalog with a runaway number of
   * items should slow a sync down, not hang the process forever.
   */
  async paginate<T = any>(
    path: string,
    token: string,
    params: Record<string, unknown> = {},
    options: { pageSize?: number; maxPages?: number; context?: string } = {},
  ): Promise<T[]> {
    const pageSize = options.pageSize || 100;
    const maxPages = options.maxPages || 200;
    const context = options.context || `paginate ${path}`;

    const results: T[] = [];
    let after: string | undefined;

    for (let page = 0; page < maxPages; page += 1) {
      const query: Record<string, unknown> = { ...params, limit: pageSize };
      if (after) query.after = after;

      const response = await this.request<GraphPage<T>>({
        path,
        token,
        params: query,
        method: 'GET',
        context,
      });

      const batch = Array.isArray(response?.data) ? response.data : [];
      results.push(...batch);

      after = response?.paging?.cursors?.after;
      // Meta omits `next` on the final page even when a cursor is still present.
      if (!response?.paging?.next || !after || batch.length === 0) break;
    }

    return results;
  }

  /** Multipart upload (WhatsApp media, catalog video). */
  async upload<T = any>(params: {
    path: string;
    token: string;
    file: { buffer: Buffer; originalname: string; mimetype: string };
    fields?: Record<string, string>;
    context?: string;
  }): Promise<T> {
    const form = new FormData();
    for (const [key, value] of Object.entries(params.fields || {})) form.append(key, value);
    form.append('file', params.file.buffer, {
      filename: params.file.originalname,
      contentType: params.file.mimetype,
    });

    const context = params.context || `upload ${params.path}`;
    try {
      const { data } = await this.http.post<T>(this.url(params.path), form, {
        headers: { Authorization: `Bearer ${params.token}`, ...form.getHeaders() },
        params: this.withProof(params.token),
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      });
      return data;
    } catch (err) {
      const normalized = normalizeMetaError(err, context);
      this.logger.error(`${context} failed - ${normalized.detail}`);
      throw toHttpException(normalized);
    }
  }

  /** Downloads bytes from a Meta media URL, which still needs the bearer token. */
  async download(url: string, token: string): Promise<{ buffer: Buffer; contentType: string }> {
    const res = await this.http.get(url, {
      headers: { Authorization: `Bearer ${token}` },
      responseType: 'arraybuffer',
    });
    return {
      buffer: Buffer.from(res.data),
      contentType: String(res.headers['content-type'] || 'application/octet-stream'),
    };
  }

  /**
   * Exchanges an Embedded Signup code for a business access token.
   * Runs on the server only - the app secret must never reach a browser.
   */
  async exchangeCodeForToken(code: string): Promise<{
    access_token: string;
    token_type?: string;
    expires_in?: number;
  }> {
    try {
      const { data } = await this.http.get(this.url('oauth/access_token'), {
        params: {
          client_id: this.meta.appId,
          client_secret: this.meta.appSecret,
          code,
        },
      });
      return data;
    } catch (err) {
      const normalized = normalizeMetaError(err, 'oauth/access_token');
      this.logger.error(`Token exchange failed - ${normalized.detail}`);
      throw toHttpException(normalized);
    }
  }

  /**
   * Inspects a token: which WABAs and businesses it actually covers, and when
   * it expires. This is how Embedded Signup tells us what was just granted.
   */
  async debugToken(token: string): Promise<{
    app_id?: string;
    expires_at?: number;
    data_access_expires_at?: number;
    is_valid?: boolean;
    scopes?: string[];
    granular_scopes?: Array<{ scope: string; target_ids?: string[] }>;
  }> {
    const appToken = `${this.meta.appId}|${this.meta.appSecret}`;
    const data = await this.request<{ data: any }>({
      path: 'debug_token',
      token: appToken,
      params: { input_token: token },
      method: 'GET',
      context: 'debug_token',
    });
    return data?.data || {};
  }
}
