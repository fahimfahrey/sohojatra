"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import { Phone } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { useRide } from "../../contexts/RideContext";
import { useAbly } from "../../contexts/AblyContext";
import { toast } from "react-hot-toast";
import { getCreatorPhoneAction } from "@/app/actions/rides";
import { logger } from "@/lib/observability/logger";

// Set to true to show the button for debugging
const DEBUG_MODE = false; // Temporarily set to true for debugging

interface FloatingCallButtonProps {
  rideId?: string; // Optional ride ID to check
}

// Define the Ably message type
interface AblyMessage {
  data: Record<string, unknown>;
}

const FloatingCallButton: React.FC<FloatingCallButtonProps> = ({ rideId }) => {
  const { user } = useAuth();
  const { rides } = useRide();
  const { subscribeToEvent } = useAbly();
  const [creatorPhone, setCreatorPhone] = useState<string | undefined>(
    DEBUG_MODE ? "1234567890" : undefined,
  );
  const [showButton, setShowButton] = useState(false);
  const [debugInfo, setDebugInfo] = useState<string[]>([]);
  const [activeRideId, setActiveRideId] = useState<string | null>(null);
  const activeRideIdRef = useRef<string | null>(null);
  useEffect(() => {
    activeRideIdRef.current = activeRideId;
  }, [activeRideId]);

  // Add debug info
  const addDebugInfo = (info: string) => {
    if (DEBUG_MODE) {
      logger.debug("[FloatingCall]", info);
      setDebugInfo((prev) => [...prev, info]);
    }
  };

  // Define checkForActiveRides as a useCallback to prevent recreation on each render
  const checkForActiveRides = useCallback(async () => {
    addDebugInfo("Running checkForActiveRides");

    // Reset state for fresh evaluation
    let shouldShowButton = false;
    let phoneToUse: string | undefined = undefined;
    let rideIdToUse: string | null = null;

    if (!user) {
      addDebugInfo("No user logged in");
      return;
    }

    const currentActiveRideId = activeRideIdRef.current;

    // Get active rides where user is a passenger but not the creator
    let activeRides = [];

    if (rideId) {
      // If specific ride ID is provided
      activeRides = rides.filter(
        (r) =>
          r.id === rideId &&
          r.passengers.includes(user.id) &&
          r.creator !== user.id &&
          r.status !== "completed" &&
          r.status !== "cancelled",
      );
      addDebugInfo(`Filtered rides by ID ${rideId}: ${activeRides.length}`);
    } else {
      // Get all active rides where user is a passenger
      activeRides = rides.filter(
        (r) =>
          r.passengers.includes(user.id) &&
          r.status !== "completed" &&
          r.status !== "cancelled" &&
          r.creator !== user.id,
      );
      addDebugInfo(
        `Found ${activeRides.length} active rides where user is passenger`,
      );
    }

    // Only show button if there is at least one active ride
    if (activeRides.length > 0) {
      // Use the first active ride
      const ride = activeRides[0];
      addDebugInfo(`Selected ride: ${ride.id}, status: ${ride.status}`);

      // Store the active ride ID for real-time updates
      rideIdToUse = ride.id;

      // If the ride has the contact phone, use it
      if (ride.contactPhone) {
        addDebugInfo(`Using ride.contactPhone: ${ride.contactPhone}`);
        phoneToUse = ride.contactPhone;
        shouldShowButton = true;
      } else {
        // Otherwise, fetch from database
        addDebugInfo(`No phone on ride object, fetching from database`);
        const phone = await fetchCreatorPhone(ride.id);
        if (phone) {
          addDebugInfo(`Found phone in database: ${phone}`);
          phoneToUse = phone;
          shouldShowButton = true;
        } else {
          addDebugInfo(`No phone found in database`);

          // Only in debug mode, show button with test number
          if (DEBUG_MODE) {
            phoneToUse = "1234567890";
            shouldShowButton = true;
          }
        }
      }
    } else {
      addDebugInfo("No active rides found where user is passenger");
    }

    // Update state only when changed to avoid render churn
    setCreatorPhone((prev) => (prev === phoneToUse ? prev : phoneToUse));
    setActiveRideId((prev) => (prev === rideIdToUse ? prev : rideIdToUse));
    setShowButton((prev) => (prev === shouldShowButton ? prev : shouldShowButton));
    void currentActiveRideId;
  }, [user, rides, rideId]);

  // Subscribe to real-time ride updates
  useEffect(() => {
    if (!user) return;

    addDebugInfo("Setting up real-time ride status subscriptions");

    // Handle any ride update (change in status, passengers, etc.)
    const handleRideUpdate = (message: AblyMessage) => {
      // Since we're getting a generic message, we need to cast and validate it
      const data = message.data as Record<string, unknown>;

      // Log the complete message for debugging
      addDebugInfo(`Received update event: ${JSON.stringify(data)}`);

      // Check if this looks like a valid ride
      if (typeof data.id !== "string" || typeof data.status !== "string") {
        addDebugInfo("Received invalid ride update data");
        return;
      }

      const rideId = data.id;
      const status = data.status;

      addDebugInfo(`Received update for ride ${rideId} with status ${status}`);

      const currentActiveRideId = activeRideIdRef.current;
      if (currentActiveRideId === rideId) {
        addDebugInfo(`This is our active ride! (${currentActiveRideId})`);

        if (status === "completed" || status === "cancelled") {
          addDebugInfo(
            `Active ride ${rideId} status changed to ${status} - hiding button immediately`,
          );

          setShowButton(false);
          setCreatorPhone(undefined);
          setActiveRideId(null);
        }
      }
    };

    // Subscribe to event types that could affect our button
    const unsubscribeUpdate = subscribeToEvent(
      "rides",
      "update",
      handleRideUpdate,
    );

    const unsubscribeComplete = subscribeToEvent(
      "rides",
      "complete",
      handleRideUpdate,
    );

    const unsubscribeCancel = subscribeToEvent(
      "rides",
      "cancel",
      handleRideUpdate,
    );

    const unsubscribeLeave = subscribeToEvent(
      "rides",
      "leave",
      handleRideUpdate,
    );

    return () => {
      unsubscribeUpdate();
      unsubscribeComplete();
      unsubscribeCancel();
      unsubscribeLeave();
    };
  }, [user, subscribeToEvent]);

  // Debug useEffect to log the current state
  useEffect(() => {
    addDebugInfo(
      `FloatingCallButton initialized. User: ${user?.id || "none"}, Rides: ${
        rides.length
      }`,
    );

    if (user && rides.length > 0) {
      // Log all rides where user is a passenger
      const userRides = rides.filter(
        (r) => r.passengers.includes(user.id) && r.creator !== user.id,
      );
      addDebugInfo(`User rides (as passenger): ${userRides.length}`);

      if (userRides.length > 0) {
        userRides.forEach((ride, i) => {
          addDebugInfo(
            `Ride ${i}: ID=${ride.id}, Status=${ride.status}, Has phone: ${
              ride.contactPhone ? "yes" : "no"
            }`,
          );
        });
      }
    }
  }, [user, rides]);

  const fetchCreatorPhone = async (targetRideId: string) => {
    try {
      addDebugInfo(
        `Fetching creator phone via server action for ride ${targetRideId}`,
      );
      const result = await getCreatorPhoneAction(targetRideId);

      if (!result.success) {
        addDebugInfo(`Server denied phone: ${result.error}`);
        return null;
      }

      addDebugInfo(`Found creator phone via server`);
      return result.data?.phone ?? null;
    } catch (err) {
      addDebugInfo(`Exception fetching creator phone: ${err}`);
      return null;
    }
  };

  // Call checkForActiveRides when dependencies change
  useEffect(() => {
    checkForActiveRides();
  }, [checkForActiveRides]);

  const handleCallCreator = () => {
    if (creatorPhone) {
      addDebugInfo(`Calling ${creatorPhone}`);
      window.location.href = `tel:${creatorPhone}`;
    } else {
      addDebugInfo("No phone number available");
      toast.error("Creator's phone number is not available");
    }
  };

  // Don't render if button shouldn't be shown
  if (!showButton || !creatorPhone) {
    return null;
  }

  return (
    <div className="fixed bottom-6 right-6 z-50">
      {/* Pulsing animation ring */}
      <div className="absolute inset-0 bg-accent-400 rounded-full animate-ping opacity-30"></div>
      <div className="absolute inset-0 bg-accent-300 rounded-full animate-ping opacity-20 animation-delay-150"></div>

      {/* Active ride indicator */}
      {activeRideId && (
        <div className="absolute -top-3 -right-3 bg-white text-xs px-2 py-1 rounded-full shadow-medium border border-gray-200 font-medium text-gray-700">
          {activeRideId.substring(0, 4)}
        </div>
      )}

      {/* Button */}
      <button
        onClick={handleCallCreator}
        className="relative flex items-center bg-gradient-to-r from-accent-500 to-accent-600 hover:from-accent-600 hover:to-accent-700 text-white px-6 py-4 rounded-full shadow-large hover:shadow-xl transition-all duration-300 transform hover:scale-105 group"
        aria-label="Call ride creator"
      >
        <div className="h-10 w-10 bg-white rounded-full flex items-center justify-center mr-3 group-hover:scale-110 transition-transform duration-200">
          <Phone className="h-5 w-5 text-accent-600" />
        </div>
        <span className="font-semibold text-base">Call Creator</span>
      </button>

      {/* Debug info panel */}
      {DEBUG_MODE && (
        <div
          className="absolute bottom-20 right-0 bg-white border border-gray-300 p-3 rounded-2xl shadow-large max-w-xs overflow-auto"
          style={{ maxHeight: "400px" }}
        >
          <h4 className="font-bold mb-2">Debug Info</h4>
          <div className="mb-2">
            <strong>Active Ride:</strong> {activeRideId || "none"}
          </div>
          <div className="mb-2">
            <strong>Show Button:</strong> {showButton ? "yes" : "no"}
          </div>
          <div className="mb-2">
            <strong>Phone:</strong> {creatorPhone || "none"}
          </div>
          <h5 className="font-bold mb-1">Log:</h5>
          <ul className="text-xs max-h-60 overflow-y-auto">
            {debugInfo.map((info, i) => (
              <li key={i} className="mb-1">
                {info}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default FloatingCallButton;
