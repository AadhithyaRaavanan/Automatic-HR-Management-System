import * as Sentry from "@sentry/nextjs";
import { sanitizeSentryEvent } from "./lib/sentry/sanitizer";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN;
const isProduction = process.env.NODE_ENV === "production";
const isTest = process.env.NODE_ENV === "test";

if (dsn && !isTest) {
  Sentry.init({
    dsn,
    tracesSampleRate: isProduction ? 0.1 : 0.0,
    beforeSend(event) {
      return sanitizeSentryEvent(event);
    },
    beforeSendTransaction(event) {
      return sanitizeSentryEvent(event);
    },
  });
}
