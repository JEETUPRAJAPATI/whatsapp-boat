import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import axios from 'axios';

/** The shape Meta returns inside `{ error: { ... } }`. */
export interface MetaErrorPayload {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  error_user_title?: string;
  error_user_msg?: string;
  fbtrace_id?: string;
}

export interface NormalizedMetaError {
  /** Message safe to show a non-technical admin. */
  message: string;
  /** Stable string the frontend can branch on. */
  code: string;
  httpStatus: number;
  metaCode: number | null;
  metaSubcode: number | null;
  /** Full detail for the server log only - never returned to the browser. */
  detail: string;
  /** True when retrying later could plausibly succeed. */
  retryable: boolean;
}

/**
 * Translates a Graph API failure into something a business owner can act on.
 *
 * Meta's raw messages routinely echo request internals and object ids, so they
 * are logged but never forwarded; the frontend only ever sees `message` and
 * `code` from here.
 */
export function normalizeMetaError(err: unknown, context = 'request'): NormalizedMetaError {
  const isAxios = axios.isAxiosError(err);
  const response = isAxios ? err.response : undefined;
  const payload: MetaErrorPayload | undefined = response?.data?.error;

  const httpStatus = response?.status ?? 0;
  const metaCode = typeof payload?.code === 'number' ? payload.code : null;
  const metaSubcode = typeof payload?.error_subcode === 'number' ? payload.error_subcode : null;
  const detail =
    payload?.error_user_msg ||
    payload?.error_user_title ||
    payload?.message ||
    (err as Error)?.message ||
    'Unknown error';

  const out = (
    message: string,
    code: string,
    status = 400,
    retryable = false,
  ): NormalizedMetaError => ({
    message,
    code,
    httpStatus: status,
    metaCode,
    metaSubcode,
    detail: `${context}: ${detail}`,
    retryable,
  });

  // --- Network / transport -------------------------------------------------
  if (isAxios && !response) {
    const timedOut = err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT';
    return out(
      timedOut
        ? 'Meta did not respond in time. Please try again.'
        : 'Could not reach the Meta API. Check the server network connection.',
      timedOut ? 'META_TIMEOUT' : 'META_UNREACHABLE',
      502,
      true,
    );
  }

  // --- Authentication ------------------------------------------------------
  if (metaCode === 190 || httpStatus === 401) {
    // Subcode 463 = expired, 467 = invalidated (password change / logout).
    const expired = metaSubcode === 463 || /expired/i.test(detail);
    return out(
      expired
        ? 'The Meta access token has expired. Reconnect this WhatsApp account to continue.'
        : 'The Meta access token is invalid. Reconnect this WhatsApp account to continue.',
      expired ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID',
      503,
    );
  }

  // --- Permissions ---------------------------------------------------------
  if (metaCode === 200 || metaCode === 10 || metaCode === 299) {
    return out(
      'Your Meta app does not have permission for this action. Check that the required ' +
        'permissions (whatsapp_business_management, whatsapp_business_messaging, ' +
        'catalog_management, business_management) were granted when connecting.',
      'PERMISSION_DENIED',
      403,
    );
  }
  if (httpStatus === 403) {
    return out(
      'Meta refused this request for this account. It usually means a missing permission ' +
        'or an account restriction.',
      'PERMISSION_DENIED',
      403,
    );
  }

  // --- Business / account verification ------------------------------------
  if (metaCode === 10900 || /business verification/i.test(detail)) {
    return out(
      'This Business Portfolio must complete Meta business verification before it can be used.',
      'BUSINESS_VERIFICATION_REQUIRED',
      400,
    );
  }
  if (/two.?factor|2fa/i.test(detail)) {
    return out(
      'Two-factor authentication must be enabled on this WhatsApp Business Account in ' +
        'Meta Business Settings.',
      'TWO_FACTOR_REQUIRED',
      400,
    );
  }

  // --- Phone number onboarding --------------------------------------------
  if (metaCode === 133005) {
    return out(
      'The two-step verification PIN is incorrect for this number.',
      'PIN_INCORRECT',
      400,
    );
  }
  if (metaCode === 133004) {
    return out('Meta is temporarily unavailable for this number. Try again shortly.', 'META_BUSY', 503, true);
  }
  if (metaCode === 133006) {
    return out(
      'This number must complete phone verification in Meta Business Manager before it can ' +
        'be registered.',
      'PHONE_VERIFICATION_REQUIRED',
      400,
    );
  }
  if (metaCode === 133008 || metaCode === 133016) {
    return out(
      'Too many registration attempts for this number. Meta has temporarily blocked further ' +
        'attempts - wait before trying again.',
      'REGISTRATION_RATE_LIMIT',
      429,
      true,
    );
  }
  if (metaCode === 133010) {
    return out(
      'This number is not registered on the WhatsApp Business Platform yet.',
      'NUMBER_NOT_REGISTERED',
      400,
    );
  }
  if (metaCode === 133015) {
    return out(
      'This number is being moved between accounts. Wait for the transfer to finish, then retry.',
      'NUMBER_IN_TRANSFER',
      409,
      true,
    );
  }
  if (metaCode === 100 && /already.*(registered|exists|in use)/i.test(detail)) {
    return out(
      'This phone number is already registered on another WhatsApp Business Account. It must ' +
        'be deleted there, or migrated, before it can be added here.',
      'NUMBER_ALREADY_REGISTERED',
      409,
    );
  }
  if (/coexistence|not eligible/i.test(detail)) {
    return out(
      'This number is not eligible for the WhatsApp Business App coexistence flow. Connect it ' +
        'through Embedded Signup in the Meta onboarding window instead.',
      'COEXISTENCE_UNAVAILABLE',
      400,
    );
  }

  // --- Messaging -----------------------------------------------------------
  if (metaCode === 131026) {
    return out(
      'This number cannot receive WhatsApp messages - it is not a WhatsApp account.',
      'NOT_A_WHATSAPP_USER',
      400,
    );
  }
  if (metaCode === 131047 || metaCode === 131051) {
    return out(
      'The 24-hour customer service window is closed for this customer. Send an approved ' +
        'template message instead.',
      'SERVICE_WINDOW_CLOSED',
      400,
    );
  }
  if (metaCode === 131021) {
    return out('The recipient number is the same as the sender number.', 'SELF_SEND', 400);
  }
  if (metaCode === 132000 || metaCode === 132001 || metaCode === 132012 || metaCode === 132015) {
    return out(
      'Meta rejected this template: it may not exist, not be approved, or its parameters do ' +
        'not match.',
      'TEMPLATE_REJECTED',
      400,
    );
  }

  // --- Catalog / commerce --------------------------------------------------
  if (metaCode === 131009 && /product|catalog/i.test(detail)) {
    return out(
      'Meta rejected the product payload. Check the price, currency and image URL.',
      'PRODUCT_REJECTED',
      400,
    );
  }
  if (/catalog.*(not found|does not exist)|no catalog/i.test(detail)) {
    return out(
      'No catalog is connected to this WhatsApp Business Account. Connect one in the Catalog ' +
        'settings first.',
      'CATALOG_NOT_FOUND',
      404,
    );
  }
  if (/image|photo/i.test(detail) && /(invalid|could not|failed|unable|rejected)/i.test(detail)) {
    return out(
      'Meta could not fetch or accept this product image. It must be a publicly reachable URL ' +
        '(at least 500x500, JPG or PNG).',
      'IMAGE_REJECTED',
      400,
    );
  }
  if (metaCode === 100 && /retailer_id/i.test(detail)) {
    return out(
      'A product with this SKU (retailer id) already exists in the catalog.',
      'DUPLICATE_RETAILER_ID',
      409,
    );
  }

  // --- Rate limiting -------------------------------------------------------
  if (metaCode === 4 || metaCode === 17 || metaCode === 32 || metaCode === 613 || metaCode === 80007) {
    return out(
      'Meta API rate limit reached for this app. The request will succeed once the limit resets.',
      'RATE_LIMITED',
      429,
      true,
    );
  }
  if (metaCode === 130429 || metaCode === 131048 || httpStatus === 429) {
    return out('WhatsApp messaging rate limit reached. Try again shortly.', 'RATE_LIMITED', 429, true);
  }

  // --- Generic -------------------------------------------------------------
  if (metaCode === 803 || httpStatus === 404) {
    return out(
      'That object does not exist on Meta, or this account cannot see it.',
      'OBJECT_NOT_FOUND',
      404,
    );
  }
  // A delete/update against an id Meta no longer has comes back as a plain
  // code 100 with subcode 33 ("Unsupported ... request. Object with ID '...'
  // does not exist...") rather than the 803/404 shape above - still means the
  // same thing: nothing left there to touch.
  if (metaCode === 100 && metaSubcode === 33) {
    return out(
      'That object does not exist on Meta, or this account cannot see it.',
      'OBJECT_NOT_FOUND',
      404,
    );
  }
  if (metaCode === 1 || metaCode === 2 || httpStatus >= 500) {
    return out(
      'Meta reported a temporary problem on their side. Please try again in a few minutes.',
      'META_TEMPORARY_ERROR',
      502,
      true,
    );
  }

  // Field-level validation complaints ("availability must be one of…") are
  // genuinely useful and contain no account internals, so they are worth
  // passing through rather than replacing with a generic apology.
  if (metaCode === 100 && isFieldValidationMessage(detail)) {
    return out(`Meta rejected this product: ${stripErrorCode(detail)}`, 'INVALID_FIELD', 400);
  }

  return out(
    payload?.error_user_msg || 'Meta rejected this request. Please review the details and retry.',
    'META_ERROR',
    400,
  );
}

/** True for messages that describe a bad field value rather than account state. */
function isFieldValidationMessage(detail: string): boolean {
  if (!detail || detail.length > 300) return false;
  // Anything that looks like an id, token or URL is not safe to echo.
  if (/\b\d{10,}\b|access_token|Bearer |https?:\/\//i.test(detail)) return false;
  return /must be|is required|invalid value|not a valid|should be/i.test(detail);
}

/** Drops Meta's leading "(#100) " prefix, which means nothing to an operator. */
function stripErrorCode(detail: string): string {
  return detail.replace(/^\(#\d+\)\s*/, '');
}

/** Turns a normalized error into the HttpException Nest should throw. */
export function toHttpException(normalized: NormalizedMetaError): HttpException {
  const body = {
    statusCode: normalized.httpStatus,
    message: normalized.message,
    code: normalized.code,
    metaErrorCode: normalized.metaCode,
    retryable: normalized.retryable,
  };

  switch (normalized.httpStatus) {
    case 403:
      return new ForbiddenException(body);
    case 404:
      return new NotFoundException(body);
    case 502:
      return new BadGatewayException(body);
    case 503:
      return new ServiceUnavailableException(body);
    default:
      return new BadRequestException(body);
  }
}
