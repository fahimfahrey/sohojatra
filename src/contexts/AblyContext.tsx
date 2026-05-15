import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from "react";
import * as Ably from "ably";
import { useAuth } from "./AuthContext";
import { toast } from "react-hot-toast";
import { encryptRealTimeData, decryptRealTimeData } from "../lib/encryption";

// Using a placeholder API key - in production, you would use environment variables
// This should be replaced with your actual Ably API key
const ABLY_API_KEY = import.meta.env.VITE_ABLY_API_KEY;

// Define proper types for Ably messages
interface AblyMessage {
  name: string;
  data: Record<string, unknown>;
  id?: string;
}

interface AblyContextType {
  ably: Ably.Realtime | null;
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

export const AblyProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const [ably, setAbly] = useState<Ably.Realtime | null>(null);
  const [connected, setConnected] = useState(false);
  const { user } = useAuth();

  useEffect(() => {
    let ablyInstance: Ably.Realtime | null = null;

    const setupAbly = () => {
      // Only initialize Ably if the user is logged in
      if (user && ABLY_API_KEY) {
        try {
          // Create Ably instance with client ID for authentication
          ablyInstance = new Ably.Realtime({
            key: ABLY_API_KEY,
            clientId: user.id,
            autoConnect: true,
            disconnectedRetryTimeout: 5000, // Retry connection after 5 seconds
            suspendedRetryTimeout: 10000, // Retry if suspended after 10 seconds
          });

          // Set up connection state change listener
          ablyInstance.connection.on("connected", () => {
            setConnected(true);
            toast.success("Connected to real-time updates");
          });

          ablyInstance.connection.on("disconnected", () => {
            setConnected(false);
            toast.error("Disconnected from real-time updates");
          });

          ablyInstance.connection.on("failed", (stateChange) => {
            setConnected(false);
            toast.error("Failed to connect to real-time updates");
          });

          ablyInstance.connection.on("suspended", () => {
            setConnected(false);
          });

          ablyInstance.connection.on("connecting", () => {
            // Connecting to Ably
          });

          setAbly(ablyInstance);
        } catch (error) {
          toast.error("Failed to initialize real-time connection");
        }
      } else if (!ABLY_API_KEY) {
        toast.error("Real-time service not configured");
      }
    };

    setupAbly();

    // Cleanup when unmounting or when user changes
    return () => {
      if (ablyInstance) {
        ablyInstance.connection.off();
        ablyInstance.close();
        setAbly(null);
        setConnected(false);
      }
    };
  }, [user]);

  // Function to publish an event to a channel
  const publishEvent = (
    channelName: string,
    eventName: string,
    data: Record<string, unknown>,
  ) => {
    if (!ably || !connected) {
      return;
    }

    try {
      // Encrypt sensitive data before publishing
      const encryptedData = {
        ...data,
        _encrypted: encryptRealTimeData(data),
      };

      const channel = ably.channels.get(channelName);
      channel.publish(eventName, encryptedData);
    } catch (error) {
      // Error publishing event
    }
  };

  // Function to subscribe to an event on a channel
  const subscribeToEvent = (
    channelName: string,
    eventName: string,
    callback: (message: AblyMessage) => void,
  ) => {
    if (!ably) {
      return () => {};
    }

    try {
      const channel = ably.channels.get(channelName);

      // Wrap the callback to add decryption and type safety
      const wrappedCallback = (message: any) => {
        try {
          // Decrypt data if it was encrypted
          let decryptedData = message.data || {};
          if (message.data?._encrypted) {
            decryptedData = decryptRealTimeData(message.data._encrypted);
          }

          // Convert to our defined type
          const typedMessage: AblyMessage = {
            name: message.name,
            data: decryptedData,
          };

          callback(typedMessage);
        } catch (decryptError) {
          // Decryption failed, pass original data
          const typedMessage: AblyMessage = {
            name: message.name,
            data: message.data || {},
          };
          callback(typedMessage);
        }
      };

      channel.subscribe(eventName, wrappedCallback);

      // Return unsubscribe function
      return () => {
        channel.unsubscribe(eventName, wrappedCallback);
      };
    } catch (error) {
      return () => {};
    }
  };

  return (
    <AblyContext.Provider
      value={{
        ably,
        connected,
        publishEvent,
        subscribeToEvent,
      }}
    >
      {children}
    </AblyContext.Provider>
  );
};

export const useAbly = () => {
  const context = useContext(AblyContext);
  if (context === undefined) {
    throw new Error("useAbly must be used within an AblyProvider");
  }
  return context;
};
