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
      authUrl: "/api/ably/token",
      clientId: user.id,
      autoConnect: true,
    });

    ablyInstance.connection.on("connected", () => setConnected(true));
    ablyInstance.connection.on("disconnected", () => setConnected(false));
    ablyInstance.connection.on("failed", () => setConnected(false));

    setAbly(ablyInstance);

    return () => {
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
    if (!ably || !connected) return;
    try {
      ably.channels.get(channelName).publish(eventName, data);
    } catch {
      // Non-critical realtime publish failure
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
