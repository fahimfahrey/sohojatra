/// <reference lib="esnext" />
/// <reference lib="webworker" />
import { defaultCache } from "@serwist/turbopack/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
  fallbacks: {
    entries: [
      {
        url: "/~offline",
        matcher({ request }) {
          return request.destination === "document";
        },
      },
    ],
  },
});

serwist.addEventListeners();

self.addEventListener("notificationclick", (event) => {
  const notification = event.notification;
  notification.close();

  const redirectPath =
    typeof notification.data?.redirectPath === "string"
      ? notification.data.redirectPath
      : "/";

  if (event.action === "redirect" && redirectPath) {
    event.waitUntil(self.clients.openWindow(redirectPath));
    return;
  }

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(
      (windowClients) => {
        if (windowClients.length > 0) {
          const targetPath = redirectPath;
          const matchingClient = windowClients.find((client) =>
            client.url.includes(targetPath),
          );
          return (matchingClient ?? windowClients[0]).focus();
        }
        return self.clients.openWindow(redirectPath);
      },
    ),
  );
});

self.addEventListener("push", (event) => {
  if (!event.data) return;

  try {
    const data = event.data.json() as {
      title?: string;
      body?: string;
      icon?: string;
      badge?: string;
      data?: { redirectPath?: string };
      requireInteraction?: boolean;
      actions?: Array<{ action: string; title: string }>;
    };

    const isMobile = /Android|iPhone|iPad|iPod/i.test(
      self.navigator?.userAgent ?? "",
    );

    const options: NotificationOptions = {
      body: data.body ?? "You have a new notification",
      icon: data.icon ?? "/banner_image.png",
      badge: data.badge ?? "/sohojatra_ico.png",
      data: data.data ?? {},
      requireInteraction: isMobile ? false : (data.requireInteraction ?? false),
    };

    event.waitUntil(
      self.registration.showNotification(data.title ?? "Sohojatra", options),
    );
  } catch {
    // Ignore malformed push payloads
  }
});
