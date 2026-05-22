"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import * as Ably from "ably";
import { useAuth } from "./AuthContext";

interface AblyMessage {
  name: string;
  data: Record<string, unknown>;
}

interface AblyContextType {
  connected: boolean;
  publishEvent: (
    channelName: string,
    eventName: string,
    data: Record<string, unknown>,
  ) => void;
  subscribeToEvent: (
    channelName: string,
    eventName: string,
    callback: (message: AblyMessage) => void,
  ) => () => void;
}

const AblyContext = createContext<AblyContextType | undefined>(undefined);

/** Channel used for ride list sync broadcasts */
export const RIDES_CHANNEL = "rides";

export function AblyProvider({ children }: { children: ReactNode }) {
  const [ably, setAbly] = useState<Ably.Realtime | null>(null);
  const [connected, setConnected] = useState(false);
  const { user } = useAuth();

  useEffect(() => {
    let ablyInstance: Ably.Realtime | null = null;

    if (!user) {
      setAbly(null);
      setConnected(false);
      return;
    }

    ablyInstance = new Ably.Realtime({
      clientId: user.id,
      transports: ["web_socket"],
      authCallback: (_tokenParams, callback) => {
        fetch("/api/ably/token", { credentials: "include" })
          .then(async (res) => {
            if (!res.ok) {
              callback("Realtime token request failed", null);
              return;
            }
            callback(null, await res.json());
          })
          .catch((err: Error) => {
            console.error("[ably/token] fetch failed", err);
            callback("Realtime token request failed", null);
          });
      },
      autoConnect: true,
    });

    const onConnected = () => setConnected(true);
    const onDisconnected = () => setConnected(false);
    const onFailed = () => setConnected(false);

    ablyInstance.connection.on("connected", onConnected);
    ablyInstance.connection.on("disconnected", onDisconnected);
    ablyInstance.connection.on("failed", onFailed);

    setAbly(ablyInstance);

    return () => {
      ablyInstance?.connection.off("connected", onConnected);
      ablyInstance?.connection.off("disconnected", onDisconnected);
      ablyInstance?.connection.off("failed", onFailed);
      ablyInstance?.close();
      setAbly(null);
      setConnected(false);
    };
  }, [user?.id]);

  const publishEvent = (
    channelName: string,
    eventName: string,
    data: Record<string, unknown>,
  ) => {
    if (!ably || ably.connection.state !== "connected") return;

    try {
      ably.channels.get(channelName).publish(eventName, data);
    } catch {
      // Ignore publish failures (stale connection, capability, etc.)
    }
  };

  const subscribeToEvent = (
    channelName: string,
    eventName: string,
    callback: (message: AblyMessage) => void,
  ) => {
    if (!ably) return () => {};

    const channel = ably.channels.get(channelName);
    const handler = (message: Ably.Types.Message) => {
      callback({
        name: message.name ?? eventName,
        data: (message.data as Record<string, unknown>) ?? {},
      });
    };

    channel.subscribe(eventName, handler);
    return () => channel.unsubscribe(eventName, handler);
  };

  return (
    <AblyContext.Provider value={{ connected, publishEvent, subscribeToEvent }}>
      {children}
    </AblyContext.Provider>
  );
}

export function useAbly() {
  const context = useContext(AblyContext);
  if (!context) {
    throw new Error("useAbly must be used within AblyProvider");
  }
  return context;
}
