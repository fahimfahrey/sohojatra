// import * as Sentry from "@sentry/nextjs";

// const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

// if (dsn) {
//   Sentry.init({
//     dsn,
//     environment:
//       process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ??
//       process.env.NEXT_PUBLIC_VERCEL_ENV ??
//       process.env.NODE_ENV,
//     release:
//       process.env.NEXT_PUBLIC_SENTRY_RELEASE ??
//       process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,
//     tracesSampleRate: Number(
//       process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? "0.1",
//     ),
//     replaysSessionSampleRate: 0,
//     replaysOnErrorSampleRate: 0,
//     sendDefaultPii: false,
//     enabled: process.env.NODE_ENV !== "test",
//     ignoreErrors: [
//       "ResizeObserver loop limit exceeded",
//       "ResizeObserver loop completed with undelivered notifications",
//       "Non-Error promise rejection captured",
//       "NEXT_REDIRECT",
//       "NEXT_NOT_FOUND",
//     ],
//     denyUrls: [/extensions\//i, /^chrome:\/\//i, /^moz-extension:\/\//i],
//     beforeSend(event) {
//       if (event.user) {
//         delete event.user.email;
//         delete event.user.ip_address;
//         delete event.user.username;
//       }
//       if (event.request) {
//         delete event.request.cookies;
//       }
//       return event;
//     },
//   });
// }

// export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
