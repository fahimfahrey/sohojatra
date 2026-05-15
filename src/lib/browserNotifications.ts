// Helper functions for browser notifications

// Check if the device is a mobile device
export const isMobileDevice = (): boolean => {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent,
  );
};

// Check if notifications are supported on this device/browser
export const isNotificationSupported = (): boolean => {
  // Basic check if Notification API is available
  if (!("Notification" in window)) {
    return false;
  }

  // iOS only supports notifications in Safari from iOS 16.4+
  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (isIOS) {
    // This is a basic check - there's no perfect way to detect Safari version via user agent
    // If we need more precise detection, we'd need feature detection
    return "serviceWorker" in navigator;
  }

  return true;
};

// Function to request notification permission
export const requestNotificationPermission = async (): Promise<boolean> => {
  if (!isNotificationSupported()) {
    return false;
  }

  if (Notification.permission === "granted") {
    return true;
  }

  if (Notification.permission !== "denied") {
    try {
      const permission = await Notification.requestPermission();
      return permission === "granted";
    } catch (error) {
      return false;
    }
  }

  return false;
};

// Check if service worker is registered
export const isServiceWorkerRegistered = async (): Promise<boolean> => {
  if ("serviceWorker" in navigator) {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      return registrations.length > 0;
    } catch (error) {
      return false;
    }
  }
  return false;
};

// Register service worker for notifications
export const registerServiceWorker =
  async (): Promise<ServiceWorkerRegistration | null> => {
    if ("serviceWorker" in navigator) {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js");
        return registration;
      } catch (error) {
        // Service worker registration failed
      }
    }
    return null;
  };

// Show a browser notification (assumes permission is already granted)
export const showBrowserNotification = async (
  title: string,
  options: {
    body: string;
    icon?: string;
    requireInteraction?: boolean;
    actions?: { action: string; title: string; deepLink?: string }[];
    data?: { redirectPath?: string; [key: string]: any };
  },
): Promise<boolean> => {
  // First check if we're on a mobile device
  const isMobile = isMobileDevice();

  // For iOS devices, we might need a different approach as web notifications
  // are limited on iOS (only Safari 16.4+ supports, with limitations)
  if (isMobile && !isNotificationSupported()) {
    return false;
  }

  // Check if permission is already granted
  // Don't request permission here - this must be done in a user event handler
  if (Notification.permission !== "granted") {
    return false;
  }

  // Ensure service worker is registered
  let swRegistration: ServiceWorkerRegistration | null = null;

  if ("serviceWorker" in navigator) {
    try {
      // Check for existing service worker
      const registrations = await navigator.serviceWorker.getRegistrations();
      if (registrations.length > 0) {
        swRegistration = registrations[0];
      } else {
        swRegistration = await registerServiceWorker();
      }
    } catch (error) {
      return false;
    }
  }

  if (!swRegistration) {
    return false;
  }

  try {
    // Simplify options for mobile to increase compatibility
    if (isMobile) {
      // On mobile, we simplify the notification to increase compatibility
      await swRegistration.showNotification(title, {
        body: options.body,
        icon: options.icon || "/banner_image.png",
        // Fewer actions and options for mobile compatibility
        data: {
          redirectPath: options.data?.redirectPath || "/",
        },
      });
    } else {
      // Full options for desktop
      await swRegistration.showNotification(title, {
        ...options,
        badge: options.icon || "/banner_image.png",
        silent: false,
      });
    }
    return true;
  } catch (error) {
    return false;
  }
};
