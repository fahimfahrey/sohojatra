"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import type { NotificationMessage } from "@/types";
import { useAuth } from "./AuthContext";
import { useAbly } from "./AblyContext";
import { getBreaker, readCache, writeCache } from "@/lib/resilient-fetch";
import { CircuitOpenError } from "@/lib/circuit-breaker";
import {
  getNotificationsAction,
  markNotificationReadAction,
  markAllNotificationsReadAction,
  createNotificationAction,
} from "@/app/actions/notifications";

interface NotificationContextType {
  notifications: NotificationMessage[];
  unreadCount: number;
  stale: boolean;
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

const POLL_INTERVAL_MS = 20_000;
const notifCacheKey = (userId: string) => `coshare.notifications.${userId}`;

export function NotificationProvider({
  children,
  initialNotifications = [],
}: {
  children: React.ReactNode;
  initialNotifications?: NotificationMessage[];
}) {
  const [notifications, setNotifications] =
    useState<NotificationMessage[]>(initialNotifications);
  const [stale, setStale] = useState(false);
  const { user } = useAuth();
  const { subscribeToEvent, connectionMode } = useAbly();

  const refresh = useCallback(async () => {
    if (!user) {
      setNotifications([]);
      setStale(false);
      return;
    }
    const breaker = getBreaker("supabase-notifications", {
      failureThreshold: 3,
      resetTimeoutMs: 30_000,
    });
    const cacheKey = notifCacheKey(user.id);

    try {
      const result = await breaker.execute(() => getNotificationsAction());
      if (result.success && result.data) {
        setNotifications(result.data);
        setStale(false);
        writeCache(cacheKey, result.data);
      } else {
        throw new Error(result.success ? "empty response" : result.error);
      }
    } catch (err) {
      if (!(err instanceof CircuitOpenError)) {
        console.warn("[notifications] refresh failed, serving cache", err);
      }
      const cached = readCache<NotificationMessage[]>(cacheKey);
      if (cached) {
        setNotifications(cached);
      }
      setStale(true);
    }
  }, [user]);

  useEffect(() => {
    if (!user) {
      setNotifications([]);
      setStale(false);
      return;
    }
    refresh();
  }, [user?.id, refresh]);

  useEffect(() => {
    if (!user) return;
    return subscribeToEvent(`notifications:${user.id}`, "new", () => {
      refresh();
    });
  }, [user?.id, subscribeToEvent, refresh]);

  // Polling fallback when Ably is unavailable.
  useEffect(() => {
    if (!user || connectionMode !== "polling") return;
    const id = setInterval(() => {
      refresh();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [user, connectionMode, refresh]);

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
        stale,
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
