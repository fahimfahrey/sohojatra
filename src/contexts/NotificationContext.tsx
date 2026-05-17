"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import type { NotificationMessage } from "@/types";
import { useAuth } from "./AuthContext";
import { useAbly } from "./AblyContext";
import {
  getNotificationsAction,
  markNotificationReadAction,
  markAllNotificationsReadAction,
  createNotificationAction,
} from "@/app/actions/notifications";

interface NotificationContextType {
  notifications: NotificationMessage[];
  unreadCount: number;
  addNotification: (
    message: string,
    type: NotificationMessage["type"],
    rideId?: string,
  ) => Promise<void>;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
}

const NotificationContext = createContext<NotificationContextType | undefined>(
  undefined,
);

export function NotificationProvider({
  children,
  initialNotifications = [],
}: {
  children: React.ReactNode;
  initialNotifications?: NotificationMessage[];
}) {
  const [notifications, setNotifications] =
    useState<NotificationMessage[]>(initialNotifications);
  const { user } = useAuth();
  const { subscribeToEvent } = useAbly();

  const refresh = async () => {
    const result = await getNotificationsAction();
    if (result.success && result.data) {
      setNotifications(result.data);
    }
  };

  useEffect(() => {
    if (!user) {
      setNotifications([]);
      return;
    }
    refresh();
  }, [user?.id]);

  useEffect(() => {
    if (!user) return;
    return subscribeToEvent(`notifications:${user.id}`, "new", () => {
      refresh();
    });
  }, [user?.id, subscribeToEvent]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const addNotification = async (
    message: string,
    type: NotificationMessage["type"],
    rideId?: string,
  ) => {
    const result = await createNotificationAction({ message, type, rideId });
    if (result.success) await refresh();
  };

  const markAsRead = async (id: string) => {
    const result = await markNotificationReadAction(id);
    if (result.success) {
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: true } : n)),
      );
    }
  };

  const markAllAsRead = async () => {
    const result = await markAllNotificationsReadAction();
    if (result.success) {
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
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
}

export function useNotification() {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error("useNotification must be used within NotificationProvider");
  }
  return context;
}
