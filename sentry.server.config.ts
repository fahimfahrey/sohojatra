import * as Sentry from "@sentry/nextjs";

const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    release: process.env.SENTRY_RELEASE ?? process.env.VERCEL_GIT_COMMIT_SHA,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0.1"),
    profilesSampleRate: 0,
    sendDefaultPii: false,
    enabled: process.env.NODE_ENV !== "test",
    ignoreErrors: [
      "NEXT_REDIRECT",
      "NEXT_NOT_FOUND",
    ],
    beforeSend(event, hint) {
      const err = hint?.originalException as { digest?: string } | undefined;
      if (typeof err?.digest === "string" && err.digest.startsWith("NEXT_REDIRECT")) {
        return null;
      }
      return scrubPii(event);
    },
  });
}

type SentryEvent = Parameters<NonNullable<Parameters<typeof Sentry.init>[0]["beforeSend"]>>[0];

function scrubPii(event: SentryEvent): SentryEvent {
  if (event.user) {
    delete event.user.email;
    delete event.user.ip_address;
    delete event.user.username;
  }
  if (event.request?.cookies) delete event.request.cookies;
  if (event.request?.headers) {
    const headers = event.request.headers as Record<string, string>;
    delete headers.cookie;
    delete headers.authorization;
    delete headers["x-csrf-token"];
  }
  return event;
}
