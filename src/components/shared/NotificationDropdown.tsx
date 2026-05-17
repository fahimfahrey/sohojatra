import React, { useState } from "react";
import Link from "next/link";
import { useNotification } from "../../contexts/NotificationContext";
import { Bell, CheckCircle, Info, Users } from "lucide-react";
import { requestNotificationPermission } from "../../lib/browserNotifications";

interface NotificationDropdownProps {
  onClose: () => void;
  isMobileDrawer?: boolean;
}

const NotificationDropdown: React.FC<NotificationDropdownProps> = ({
  onClose,
  isMobileDrawer = false,
}) => {
  const { notifications, markAsRead, markAllAsRead } = useNotification();
  const [permissionStatus, setPermissionStatus] = useState<
    "granted" | "denied" | "default"
  >(typeof Notification !== "undefined" ? Notification.permission : "default");

  const handleRequestPermission = async () => {
    const granted = await requestNotificationPermission();
    setPermissionStatus(granted ? "granted" : "denied");
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInMs = now.getTime() - date.getTime();
    const diffInMin = Math.floor(diffInMs / 60000);
    const diffInHours = Math.floor(diffInMin / 60);
    const diffInDays = Math.floor(diffInHours / 24);

    if (diffInMin < 1) return "Just now";
    if (diffInMin < 60) return `${diffInMin}m ago`;
    if (diffInHours < 24) return `${diffInHours}h ago`;
    return `${diffInDays}d ago`;
  };

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case "match":
        return <CheckCircle className="h-5 w-5 text-green-500" />;
      case "update":
        return <Info className="h-5 w-5 text-blue-500" />;
      case "join":
        return <Users className="h-5 w-5 text-purple-500" />;
      case "leave":
        return (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-5 w-5 text-amber-500"
          >
            <path d="M14 8v-2a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2v-2" />
            <path d="M9 12h12l-3-3" />
            <path d="M18 15l3-3" />
          </svg>
        );
      case "system":
      default:
        return <Bell className="h-5 w-5 text-gray-500" />;
    }
  };

  // Different styling for mobile drawer vs desktop dropdown
  const containerClass = isMobileDrawer
    ? "w-full bg-white"
    : "absolute right-0 mt-2 w-96 bg-white rounded-2xl shadow-large border border-gray-200 z-50";

  return (
    <div className={containerClass}>
      {!isMobileDrawer && (
        <div className="p-4 border-b border-gray-200 bg-gradient-to-r from-accent-50 to-accent-100 rounded-t-2xl">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-bold text-gray-900">Notifications</h3>
            <button
              onClick={markAllAsRead}
              className="text-sm text-accent-600 hover:text-accent-700 font-medium"
            >
              Mark all as read
            </button>
          </div>
        </div>
      )}

      {isMobileDrawer && (
        <div className="p-4 border-b border-gray-200">
          <button
            onClick={markAllAsRead}
            className="text-sm text-accent-600 hover:text-accent-700 font-medium"
          >
            Mark all as read
          </button>
        </div>
      )}

      <div className={isMobileDrawer ? "" : "max-h-96 overflow-y-auto"}>
        {notifications.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <Bell className="h-8 w-8 mx-auto mb-3 text-gray-300" />
            <p className="text-sm">No notifications yet</p>
          </div>
        ) : (
          <div>
            {notifications.map((notification) => (
              <div
                key={notification.id}
                className={`p-4 border-b border-gray-100 hover:bg-gray-50 transition-colors cursor-pointer ${
                  !notification.read ? "bg-accent-50" : ""
                }`}
                onClick={() => markAsRead(notification.id)}
              >
                <div className="flex">
                  <div className="flex-shrink-0 mr-3 mt-1">
                    {getNotificationIcon(notification.type)}
                  </div>
                  <div className="w-full">
                    <div className="flex justify-between">
                      <p
                        className={`text-sm leading-relaxed ${
                          !notification.read
                            ? "font-medium text-gray-900"
                            : "text-gray-700"
                        }`}
                      >
                        {notification.message}
                      </p>
                      <span className="text-xs text-gray-500 ml-2 whitespace-nowrap">
                        {formatTime(notification.createdAt)}
                      </span>
                    </div>
                    {notification.rideId && (
                      <Link
                        href={`/rides/${notification.rideId}`}
                        className="mt-2 text-xs text-accent-600 hover:text-accent-700 font-medium"
                        onClick={onClose}
                      >
                        View ride details →
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {!isMobileDrawer && (
        <div className="p-4 bg-gray-50 border-t border-gray-200 rounded-b-2xl">
          {permissionStatus !== "granted" && (
            <button
              onClick={handleRequestPermission}
              className="w-full py-2 mb-2 text-sm bg-accent-600 text-white hover:bg-accent-700 transition-colors font-medium rounded-lg"
            >
              {permissionStatus === "denied"
                ? "Notifications Blocked"
                : "Enable Notifications"}
            </button>
          )}
          <button
            onClick={onClose}
            className="w-full py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors font-medium"
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
};

export default NotificationDropdown;
