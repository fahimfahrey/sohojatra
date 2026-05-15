import { useEffect, useState } from "react";
import { Smartphone, Wifi, WifiOff } from "lucide-react";
import { isPWA } from "../../lib/pwa";

export const PWAStatus = () => {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [showStatus, setShowStatus] = useState(false);
  const isInstalledPWA = isPWA();

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => {
      setIsOnline(false);
      setShowStatus(true);
      // Hide after 5 seconds
      setTimeout(() => setShowStatus(false), 5000);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Only show status when offline or when PWA is installed
  if (!showStatus && isOnline) {
    return null;
  }

  return (
    <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50 animate-slide-in">
      <div
        className={`flex items-center gap-2 px-4 py-2 rounded-full shadow-lg ${
          isOnline ? "bg-green-500 text-white" : "bg-red-500 text-white"
        }`}
      >
        {isOnline ? (
          <>
            <Wifi className="w-4 h-4" />
            <span className="text-sm font-medium">Back online</span>
          </>
        ) : (
          <>
            <WifiOff className="w-4 h-4" />
            <span className="text-sm font-medium">You're offline</span>
          </>
        )}

        {isInstalledPWA && <Smartphone className="w-4 h-4 ml-2 opacity-70" />}
      </div>
    </div>
  );
};
