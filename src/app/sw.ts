/// <reference lib="esnext" />
/// <reference lib="webworker" />
import { defaultCache } from "@serwist/turbopack/worker";
import type { PrecacheEntry, RuntimeCaching, SerwistGlobalConfig } from "serwist";
import { NetworkOnly, Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

// Map-tile and Leaflet marker-image hosts. These serve *opaque* cross-origin
// responses, which the browser pads to ~7 MB each in Cache Storage accounting.
// serwist's defaultCache would otherwise store them (tiles ending in `.png`
// hit `static-image-assets`, the rest hit the `cross-origin` bucket), so a
// minute of panning the map balloons reported storage into the hundreds of MB
// and the per-request expiration bookkeeping janks the UI. Never cache them —
// always go straight to the network so nothing accumulates on disk.
const TILE_HOSTS = [
  "google.com", // mt{0-3}.google.com/vt tiles
  "tile.openstreetmap.org",
  "unpkg.com", // leaflet marker icon/shadow PNGs
];

const noStoreTiles: RuntimeCaching = {
  matcher: ({ url }) => TILE_HOSTS.some((host) => url.hostname.endsWith(host)),
  handler: new NetworkOnly(),
};

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  // noStoreTiles must precede defaultCache — the first matching route wins,
  // and defaultCache's image/cross-origin rules would otherwise claim tiles.
  runtimeCaching: [noStoreTiles, ...defaultCache],
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

// One-time reclaim: users who ran an earlier build already have opaque map
// tiles bloating the runtime caches (`static-image-assets` keeps them for 30
// days). Purge any tile-host entries on activation so the space frees itself
// on the next visit instead of waiting for expiration or a manual clear.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const cacheName of await caches.keys()) {
        const cache = await caches.open(cacheName);
        const requests = await cache.keys();
        await Promise.all(
          requests
            .filter((request) => {
              try {
                const { hostname } = new URL(request.url);
                return TILE_HOSTS.some((host) => hostname.endsWith(host));
              } catch {
                return false;
              }
            })
            .map((request) => cache.delete(request)),
        );
      }
    })(),
  );
});

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
