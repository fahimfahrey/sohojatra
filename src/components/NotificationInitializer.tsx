import { useEffect, useState } from "react";
import {
  registerServiceWorker,
  requestNotificationPermission,
  isMobileDevice,
  isNotificationSupported,
} from "../lib/browserNotifications";

/**
 * A component that initializes the notification system
 * Including service worker registration and permission request
 */
const NotificationInitializer: React.FC = () => {
  const [initialized, setInitialized] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [isSupported, setIsSupported] = useState(false);

  useEffect(() => {
    // Detect device capabilities
    if (typeof window !== "undefined") {
      const mobile = isMobileDevice();
      const supported = isNotificationSupported();

      setIsMobile(mobile);
      setIsSupported(supported);
    }
  }, []);

  useEffect(() => {
    const initializeNotifications = async () => {
      if (!initialized && typeof window !== "undefined") {
        try {
          // Only register service worker if notifications are supported
          if (isSupported) {
            // Only request permission if user has already granted it or hasn't denied it
            // Don't request permission automatically - let user click a button instead
            if (Notification.permission === "granted") {
              // Permission already granted, just register service worker
              if (!isMobile) {
                await registerServiceWorker();
              } else {
                try {
                  await registerServiceWorker();
                } catch (mobileError) {
                  // Mobile service worker registration failed, continue anyway
                }
              }
            }
            // If permission is "denied" or "default", don't request it automatically
            // This prevents the Firefox warning about requesting permission outside user interaction
          }

          setInitialized(true);
        } catch (error) {
          // Still mark as initialized to prevent endless retries
          setInitialized(true);
        }
      }
    };

    initializeNotifications();
  }, [initialized, isSupported, isMobile]);

  // This component doesn't render anything
  return null;
};

export default NotificationInitializer;
