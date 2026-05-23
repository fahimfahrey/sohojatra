"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import * as Ably from "ably";
import { useAuth } from "./AuthContext";
import { CircuitBreaker } from "@/lib/circuit-breaker";
import {
  encryptRealTimeData,
  decryptRealTimeData,
} from "@/lib/encryption";
import { logger } from "@/lib/observability/logger";

interface AblyMessage {
  name: string;
  data: Record<string, unknown>;
}

const ENVELOPE_VERSION = 1;

interface EncryptedEnvelope {
  __enc: number;
  p: string;
}

function isEncryptedEnvelope(value: unknown): value is EncryptedEnvelope {
  if (!value || typeof value !== "object") return false;
  const env = value as Record<string, unknown>;
  return (
    env.__enc === ENVELOPE_VERSION &&
    typeof env.p === "string" &&
    env.p.length > 0
  );
}

export type ConnectionMode = "realtime" | "polling" | "offline";

interface AblyContextType {
  connected: boolean;
  connectionMode: ConnectionMode;
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
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>("offline");
  const { user } = useAuth();
  const breakerRef = useRef(
    new CircuitBreaker("ably-connection", {
      failureThreshold: 3,
      resetTimeoutMs: 60_000,
    }),
  );

  useEffect(() => {
    let ablyInstance: Ably.Realtime | null = null;
    const breaker = breakerRef.current;

    if (!user) {
      setAbly(null);
      setConnected(false);
      setConnectionMode("offline");
      breaker.reset();
      return;
    }

    ablyInstance = new Ably.Realtime({
      clientId: user.id,
      transports: ["web_socket"],
      authCallback: (_tokenParams, callback) => {
        fetch("/api/ably/token", { credentials: "include" })
          .then(async (res) => {
            if (!res.ok) {
              breaker.recordFailure();
              callback("Realtime token request failed", null);
              return;
            }
            callback(null, await res.json());
          })
          .catch((err: Error) => {
            console.error("[ably/token] fetch failed", err);
            breaker.recordFailure();
            callback("Realtime token request failed", null);
          });
      },
      autoConnect: true,
    });

    const onConnected = () => {
      breaker.recordSuccess();
      setConnected(true);
      setConnectionMode("realtime");
    };
    const onDisconnected = () => {
      setConnected(false);
    };
    const onSuspended = () => {
      breaker.recordFailure();
      setConnected(false);
      setConnectionMode("polling");
    };
    const onFailed = () => {
      breaker.recordFailure();
      setConnected(false);
      setConnectionMode("polling");
    };

    ablyInstance.connection.on("connected", onConnected);
    ablyInstance.connection.on("disconnected", onDisconnected);
    ablyInstance.connection.on("suspended", onSuspended);
    ablyInstance.connection.on("failed", onFailed);

    setAbly(ablyInstance);

    return () => {
      ablyInstance?.connection.off("connected", onConnected);
      ablyInstance?.connection.off("disconnected", onDisconnected);
      ablyInstance?.connection.off("suspended", onSuspended);
      ablyInstance?.connection.off("failed", onFailed);
      ablyInstance?.close();
      setAbly(null);
      setConnected(false);
      setConnectionMode("offline");
    };
  }, [user?.id]);

  const publishQueueRef = useRef<Promise<void>>(Promise.resolve());

  const publishEvent = (
    channelName: string,
    eventName: string,
    data: Record<string, unknown>,
  ) => {
    if (!ably || ably.connection.state !== "connected") return;

    publishQueueRef.current = publishQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        try {
          const ciphertext = await encryptRealTimeData(data);
          const envelope: EncryptedEnvelope = {
            __enc: ENVELOPE_VERSION,
            p: ciphertext,
          };
          ably.channels.get(channelName).publish(eventName, envelope);
        } catch (err) {
          logger.warn("[ably] publish encryption failed", {
            channel: channelName,
            event: eventName,
            error: (err as Error).message,
          });
        }
      });
  };

  const subscribeToEvent = (
    channelName: string,
    eventName: string,
    callback: (message: AblyMessage) => void,
  ) => {
    if (!ably) return () => {};

    const channel = ably.channels.get(channelName);
    const handler = (message: Ably.Types.Message) => {
      const raw = message.data;
      const name = message.name ?? eventName;

      if (isEncryptedEnvelope(raw)) {
        decryptRealTimeData(raw.p)
          .then((plaintext) => callback({ name, data: plaintext }))
          .catch((err: Error) => {
            logger.warn("[ably] subscribe decrypt failed", {
              channel: channelName,
              event: eventName,
              error: err.message,
            });
          });
        return;
      }

      callback({
        name,
        data: (raw as Record<string, unknown>) ?? {},
      });
    };

    channel.subscribe(eventName, handler);
    return () => channel.unsubscribe(eventName, handler);
  };

  return (
    <AblyContext.Provider
      value={{
        connected,
        connectionMode,
        publishEvent,
        subscribeToEvent,
      }}
    >
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
