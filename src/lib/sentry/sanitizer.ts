/**
 * Sentry PII Sanitizer
 * Strips sensitive credentials, auth headers, tokens, OTP codes, and personal identifiers
 * before error events and transactions are transmitted to Sentry.
 */

const SENSITIVE_KEYS = new Set([
  "password",
  "oldpassword",
  "newpassword",
  "confirmpassword",
  "token",
  "invitetoken",
  "turnstiletoken",
  "captchatoken",
  "otp",
  "code",
  "secret",
  "setupkey",
  "authorization",
  "cookie",
  "supabase_service_role_key",
  "resend_api_key",
  "turnstile_secret_key",
  "upstash_redis_rest_token",
]);

export function sanitizeObject(obj: any): any {
  if (!obj || typeof obj !== "object") return obj;

  if (Array.isArray(obj)) {
    return obj.map(sanitizeObject);
  }

  const sanitized: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase().replace(/[-_]/g, "");
    if (SENSITIVE_KEYS.has(lowerKey)) {
      sanitized[key] = "[REDACTED]";
    } else if (value && typeof value === "object") {
      sanitized[key] = sanitizeObject(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

export function sanitizeSentryBreadcrumb(breadcrumb: any): any {
  if (!breadcrumb) return breadcrumb;
  if (breadcrumb.data && typeof breadcrumb.data === "object") {
    breadcrumb.data = sanitizeObject(breadcrumb.data);
  }
  return breadcrumb;
}

export function sanitizeSentryEvent(event: any): any {
  if (!event) return event;

  // Sanitize Request Headers
  if (event.request?.headers) {
    if (event.request.headers.authorization) {
      event.request.headers.authorization = "[REDACTED]";
    }
    if (event.request.headers.cookie) {
      event.request.headers.cookie = "[REDACTED]";
    }
    if (event.request.headers["x-supabase-auth-token"]) {
      event.request.headers["x-supabase-auth-token"] = "[REDACTED]";
    }
  }

  // Sanitize Request Body / Data
  if (event.request?.data) {
    if (typeof event.request.data === "string") {
      try {
        const parsed = JSON.parse(event.request.data);
        event.request.data = JSON.stringify(sanitizeObject(parsed));
      } catch {
        // If not JSON, leave or mask if containing sensitive keywords
      }
    } else if (typeof event.request.data === "object") {
      event.request.data = sanitizeObject(event.request.data);
    }
  }

  // Sanitize Query String
  if (event.request?.query_string && typeof event.request.query_string === "object") {
    event.request.query_string = sanitizeObject(event.request.query_string);
  }

  // Sanitize Extra Context
  if (event.extra) {
    event.extra = sanitizeObject(event.extra);
  }

  return event;
}
