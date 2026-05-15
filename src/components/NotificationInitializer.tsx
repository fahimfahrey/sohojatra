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
            // Request permission (this will only prompt if not already granted/denied)
            await requestNotificationPermission();

            // On mobile, we might want to be more careful with service worker registration
            // Some mobile browsers have issues with service workers
            if (!isMobile) {
              await registerServiceWorker();
            } else {
              // For mobile, we might use a more cautious approach
              try {
                await registerServiceWorker();
              } catch (mobileError) {              }
            }
          } else {          }

          setInitialized(true);        } catch (error) {          // Still mark as initialized to prevent endless retries
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
