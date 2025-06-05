import React, { createContext, useContext, useState, useEffect } from "react";
import { Notification, RideRequest } from "../types";
import { useAuth } from "./AuthContext";
import { useAbly } from "./AblyContext";
import { toast } from "react-hot-toast";
import { supabase } from "../lib/supabase";
import * as Ably from "ably";
import {
  showBrowserNotification,
  requestNotificationPermission,
  registerServiceWorker,
  isMobileDevice,
  isNotificationSupported,
} from "../lib/browserNotifications";

interface NotificationContextType {
  notifications: Notification[];
  unreadCount: number;
  addNotification: (
    message: string,
    type: Notification["type"],
    rideId?: string
  ) => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
}

const NotificationContext = createContext<NotificationContextType | undefined>(
  undefined
);

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [notificationPermissionRequested, setNotificationPermissionRequested] =
    useState(false);
  const [isDeviceMobile, setIsDeviceMobile] = useState(false);
  const [areNotificationsSupported, setAreNotificationsSupported] =
    useState(true);
  const { user } = useAuth();
  const { subscribeToEvent } = useAbly();

  // Check device and notification support
  useEffect(() => {
    if (typeof window !== "undefined") {
      const mobile = isMobileDevice();
      const supported = isNotificationSupported();

      setIsDeviceMobile(mobile);
      setAreNotificationsSupported(supported);

      console.log(
        `Device is${mobile ? "" : " not"} mobile, notifications ${
          supported ? "are" : "are not"
        } supported`
      );
    }
  }, []);

  // Initialize service worker and request notification permission
  useEffect(() => {
    const initializeNotifications = async () => {
      if (!notificationPermissionRequested && areNotificationsSupported) {
        await requestNotificationPermission();
        if (!isDeviceMobile) {
          // Service workers can be problematic on some mobile browsers
          await registerServiceWorker();
        }
        setNotificationPermissionRequested(true);
      }
    };

    initializeNotifications();
  }, [
    notificationPermissionRequested,
    areNotificationsSupported,
    isDeviceMobile,
  ]);

  // Load notifications from Supabase
  useEffect(() => {
    if (!user) {
      setNotifications([]);
      return;
    }

    const fetchNotifications = async () => {
      try {
        const { data, error } = await supabase
          .from("notifications")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false });

        if (error) {
          console.error("Error fetching notifications:", error);
          return;
        }

        if (data) {
          // Transform data to match our Notification type
          const transformedNotifications = data.map((notification) => ({
            id: notification.id,
            userId: notification.user_id,
            message: notification.message,
            read: notification.read,
            type: notification.type as Notification["type"],
            rideId: notification.ride_id,
            createdAt: notification.created_at,
          }));

          setNotifications(transformedNotifications);
        }
      } catch (error) {
        console.error("Error in notification fetching process:", error);
      }
    };

    fetchNotifications();

    // Set up subscription for real-time updates
    const notificationSubscription = supabase
      .channel("notification_changes")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          fetchNotifications();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(notificationSubscription);
    };
  }, [user]);

  // Listen for Ably events that would trigger notifications
  useEffect(() => {
    if (!user) return;

    const handleRideUpdate = (message: { data: Record<string, unknown> }) => {
      const data = message.data as RideRequest;
      console.log("Received ride update event:", data.status, data);

      // Check if the user is part of this ride
      if (data.creator === user.id || data.passengers.includes(user.id)) {
        let notificationMessage = "";

        // Different messages based on ride status
        if (data.status === "completed") {
          notificationMessage = `Your ride to ${data.destination.address} has been completed.`;
        } else if (data.status === "cancelled") {
          notificationMessage = `Your ride to ${data.destination.address} has been cancelled.`;
        } else {
          notificationMessage = `Ride to ${data.destination.address} has been updated.`;
        }

        console.log(
          "Adding notification for ride update:",
          notificationMessage
        );
        addNotification(notificationMessage, "update", data.id);
      }
    };

    const handleRideJoin = (message: { data: Record<string, unknown> }) => {
      const data = message.data as RideRequest;
      // If the user is the creator, notify them when someone joins
      if (data.creator === user.id) {
        const notificationMessage = `A new passenger has joined your ride to ${data.destination.address}.`;
        addNotification(notificationMessage, "join", data.id);
      }
    };

    const handleRideLeave = (message: { data: Record<string, unknown> }) => {
      const data = message.data as RideRequest;
      // If the user is the creator, notify them when someone leaves
      if (data.creator === user.id) {
        const notificationMessage = `A passenger has left your ride to ${data.destination.address}.`;
        // Now we can use "leave" type properly
        addNotification(notificationMessage, "leave", data.id);
      }
    };

    // Subscribe to ride events on the "rides" channel
    const unsubscribeUpdate = subscribeToEvent(
      "rides",
      "update",
      handleRideUpdate
    );
    const unsubscribeJoin = subscribeToEvent("rides", "join", handleRideJoin);
    const unsubscribeLeave = subscribeToEvent(
      "rides",
      "leave",
      handleRideLeave
    );

    return () => {
      unsubscribeUpdate();
      unsubscribeJoin();
      unsubscribeLeave();
    };
  }, [user, subscribeToEvent]);

  const unreadCount = notifications.filter(
    (notification) => !notification.read
  ).length;

  const addNotification = async (
    message: string,
    type: Notification["type"],
    rideId?: string
  ) => {
    if (!user) return;

    try {
      // Insert notification into Supabase
      const { data, error } = await supabase
        .from("notifications")
        .insert({
          user_id: user.id,
          message,
          type,
          read: false,
          ride_id: rideId,
        })
        .select()
        .single();

      if (error) {
        console.error("Error adding notification:", error);
        return;
      }

      if (!data) {
        console.error("No data returned when adding notification");
        return;
      }

      // Create notification object for the client
      const newNotification: Notification = {
        id: data.id,
        userId: user.id,
        message,
        read: false,
        type,
        rideId,
        createdAt: data.created_at,
      };

      // Update local state
      setNotifications((prev) => [newNotification, ...prev]);

      // Show toast notification (works on all devices)
      toast(message, {
        icon:
          type === "match"
            ? "🔍"
            : type === "join"
            ? "👤"
            : type === "leave"
            ? "👋"
            : "🔔",
        duration: 4000,
      });

      // Show browser notification if supported
      if (areNotificationsSupported) {
        const icon = "/banner_image.png";
        let redirectPath = "/notifications";

        // Add ride-specific redirect if available
        if (rideId) {
          redirectPath = `/rides/${rideId}`; // Updated to match route pattern
        }

        showBrowserNotification("Sohojatra Notification", {
          body: message,
          icon,
          requireInteraction: !isDeviceMobile, // Don't require interaction on mobile
          actions: isDeviceMobile
            ? []
            : [
                {
                  action: "redirect",
                  title: "View Details",
                  deepLink: redirectPath,
                },
              ],
          data: {
            redirectPath,
            notificationId: data.id,
            type,
          },
        }).catch((err) => {
          console.error("Failed to show browser notification:", err);
        });
      }
    } catch (error) {
      console.error("Error adding notification:", error);
    }
  };

  const markAsRead = async (id: string) => {
    if (!user) return;

    try {
      // Make sure the notification exists and belongs to the user
      const notificationToUpdate = notifications.find((n) => n.id === id);
      if (!notificationToUpdate || notificationToUpdate.userId !== user.id) {
        console.error("Notification not found or doesn't belong to the user");
        return;
      }

      // Get the full notification data to preserve all fields
      const { data: notificationData, error: fetchError } = await supabase
        .from("notifications")
        .select("*")
        .eq("id", id)
        .single();

      if (fetchError) {
        console.error("Error fetching notification:", fetchError);
        return;
      }

      // Update the notification preserving all fields
      const { error } = await supabase.from("notifications").upsert({
        ...notificationData,
        read: true,
      });

      if (error) {
        console.error("Error marking notification as read:", error);
        return;
      }

      // Update local state
      setNotifications((prev) =>
        prev.map((notification) =>
          notification.id === id
            ? { ...notification, read: true }
            : notification
        )
      );
    } catch (error) {
      console.error("Error marking notification as read:", error);
    }
  };

  const markAllAsRead = async () => {
    if (!user) return;

    // Check if there are any unread notifications
    const unreadNotificationsExist = notifications.some(
      (notification) => !notification.read
    );
    if (!unreadNotificationsExist) return;

    try {
      // Get all unread notifications with all fields
      const { data: unreadNotifications, error: fetchError } = await supabase
        .from("notifications")
        .select("*") // Get all fields
        .eq("user_id", user.id)
        .eq("read", false);

      if (fetchError) {
        console.error("Error fetching unread notifications:", fetchError);
        return;
      }

      if (!unreadNotifications || unreadNotifications.length === 0) {
        return; // No unread notifications to update
      }

      // Keep all fields but update the read status
      const updates = unreadNotifications.map((notification) => ({
        ...notification, // Preserve all existing fields
        read: true, // Update read status
      }));

      const { error } = await supabase.from("notifications").upsert(updates);

      if (error) {
        console.error("Error marking all notifications as read:", error);
        return;
      }

      // Update local state
      setNotifications((prev) =>
        prev.map((notification) => ({ ...notification, read: true }))
      );
    } catch (error) {
      console.error("Error marking all notifications as read:", error);
    }
  };

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        unreadCount,
        addNotification,
        markAsRead,
        markAllAsRead,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
};

export const useNotification = () => {
  const context = useContext(NotificationContext);
  if (context === undefined) {
    throw new Error(
      "useNotification must be used within a NotificationProvider"
    );
  }
  return context;
};
