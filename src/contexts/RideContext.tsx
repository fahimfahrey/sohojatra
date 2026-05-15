import React, { createContext, useContext, useState, useEffect } from "react";
import { RideRequest, Location, VehicleType, RideStatus } from "../types";
import { useAuth } from "./AuthContext";
import { useAbly } from "./AblyContext";
import { supabase } from "../lib/supabase";
import {
  updateRideStatus,
  fetchUserRides,
  searchRidesByRoute,
} from "../lib/database";
import { notifyAllRidePassengers } from "../lib/notifications";

interface RideContextType {
  rides: RideRequest[]; // Only user's own rides for security
  userRides: RideRequest[];
  loading: boolean;
  createRideRequest: (
    startingPoint: Location,
    destination: Location,
    totalSeats: number,
    contactPhone: string,
    vehicle: VehicleType,
  ) => Promise<RideRequest>;
  joinRideRequest: (rideId: string, contactPhone: string) => Promise<void>;
  cancelRideRequest: (rideId: string) => Promise<void>;
  completeRideRequest: (rideId: string) => Promise<void>;
  findMatchingRides: (
    startPoint: Location,
    endPoint: Location,
    vehicleFilter?: VehicleType | null,
  ) => Promise<RideRequest[]>; // Now async for secure server-side search
  syncRideStatus: (rideId: string) => Promise<void>;
  refreshUserRides: () => Promise<void>; // Only refresh user's own rides
}

const RideContext = createContext<RideContextType | undefined>(undefined);

export const RideProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [rides, setRides] = useState<RideRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();
  const { publishEvent, subscribeToEvent } = useAbly();

  // SECURE: Only fetch rides that belong to the current user
  const fetchRides = async () => {
    if (!user) {
      setRides([]);
      setLoading(false);
      return;
    }

    try {
      console.log("Fetching user's rides only (secure)");
      const userRidesData = await fetchUserRides(user.id);
      setRides(userRidesData);
    } catch (error) {
      console.error("Error fetching user rides:", error);
    } finally {
      setLoading(false);
    }
  };

  // Public function to refresh user's rides only
  const refreshUserRides = async () => {
    console.log("Refreshing user rides");
    await fetchRides();
  };

  // Load only user's rides from Supabase
  useEffect(() => {
    fetchRides();

    // Set up subscription for real-time updates
    const rideSubscription = supabase
      .channel("ride_changes")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "ride_requests",
        },
        (payload) => {
          console.log("Ride change detected:", payload);
          // Refresh user's rides when any ride changes
          fetchRides();
        },
      )
      .subscribe();

    const passengerSubscription = supabase
      .channel("passenger_changes")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "ride_passengers",
        },
        (payload) => {
          console.log("Passenger change detected:", payload);
          fetchRides();
        },
      )
      .subscribe();

    // Add Ably event subscription for sync events
    let unsubscribeSync = () => {};

    if (subscribeToEvent) {
      unsubscribeSync = subscribeToEvent("rides", "sync", () => {
        console.log("Ably sync event received");
        fetchRides();
      });
    }

    return () => {
      supabase.removeChannel(rideSubscription);
      supabase.removeChannel(passengerSubscription);
      if (unsubscribeSync) unsubscribeSync();
    };
  }, [user, subscribeToEvent]);

  // Filter rides that the current user is part of (should be all of them now)
  const userRides = rides;

  const createRideRequest = async (
    startingPoint: Location,
    destination: Location,
    totalSeats: number,
    contactPhone: string,
    vehicle: VehicleType,
  ): Promise<RideRequest> => {
    if (!user) throw new Error("User must be logged in");

    try {
      // Insert ride request
      const { data: rideData, error: rideError } = await supabase
        .from("ride_requests")
        .insert({
          creator_id: user.id,
          starting_point: startingPoint,
          destination: destination,
          seats_available: totalSeats - 1, // Creator takes one seat
          total_seats: totalSeats,
          vehicle: vehicle,
          status: "open",
          contact_phone: contactPhone,
        })
        .select()
        .single();

      if (rideError) {
        console.error("Error creating ride:", rideError);
        throw new Error(rideError.message);
      }

      if (!rideData) {
        throw new Error("Failed to create ride");
      }

      // Insert creator as a passenger
      const { error: passengerError } = await supabase
        .from("ride_passengers")
        .insert({
          ride_id: rideData.id,
          user_id: user.id,
          contact_phone: contactPhone,
        });

      if (passengerError) {
        console.error("Error adding creator as passenger:", passengerError);
        throw new Error(passengerError.message);
      }

      // Create ride object for the client
      const newRide: RideRequest = {
        id: rideData.id,
        creator: user.id,
        startingPoint,
        destination,
        seatsAvailable: totalSeats - 1,
        totalSeats,
        passengers: [user.id],
        status: "open",
        vehicle: vehicle,
        createdAt: rideData.created_at,
        contactPhone: contactPhone,
      };

      // Update local state immediately
      setRides((prevRides) => [...prevRides, newRide]);

      // Emit Ably event for real-time updates
      publishEvent("rides", "new", newRide);

      // Send sync events to ensure delivery
      const syncPayload = {
        timestamp: new Date().toISOString(),
        rideId: newRide.id,
        action: "create",
      };

      publishEvent("rides", "sync", syncPayload);

      setTimeout(() => {
        publishEvent("rides", "sync", {
          ...syncPayload,
          retry: 1,
        });
      }, 500);

      return newRide;
    } catch (error) {
      console.error("Error in createRideRequest:", error);
      throw error;
    }
  };

  const joinRideRequest = async (
    rideId: string,
    contactPhone: string,
  ): Promise<void> => {
    if (!user) throw new Error("User must be logged in");

    try {
      // Add user as a passenger
      const { error: passengerError } = await supabase
        .from("ride_passengers")
        .insert({
          ride_id: rideId,
          user_id: user.id,
          contact_phone: contactPhone,
        });

      if (passengerError) {
        console.error("Error joining ride:", passengerError);
        throw new Error(passengerError.message);
      }

      // Get current ride to check seat availability
      const { data: ride, error: rideError } = await supabase
        .from("ride_requests")
        .select("*")
        .eq("id", rideId)
        .single();

      if (rideError) {
        console.error("Error fetching ride:", rideError);
        throw new Error(rideError.message);
      }

      // Update ride available seats
      const newSeatsAvailable = ride.seats_available - 1;
      const newStatus = newSeatsAvailable <= 0 ? "full" : "open";

      const { error: updateError } = await supabase
        .from("ride_requests")
        .update({
          seats_available: newSeatsAvailable,
          status: newStatus,
        })
        .eq("id", rideId);

      if (updateError) {
        console.error("Error updating ride:", updateError);
        throw new Error(updateError.message);
      }

      // Refresh user's rides to include the newly joined ride
      await fetchRides();

      // Emit Ably events
      publishEvent("rides", "join", { rideId, userId: user.id });
    } catch (error) {
      console.error("Error in joinRideRequest:", error);
      throw error;
    }
  };

  const cancelRideRequest = async (rideId: string): Promise<void> => {
    if (!user) throw new Error("User must be logged in");

    // Find ride
    const ride = rides.find((r) => r.id === rideId);
    if (!ride) throw new Error("Ride not found");

    // Check if user is part of the ride
    if (ride.creator !== user.id && !ride.passengers.includes(user.id)) {
      throw new Error("You are not part of this ride");
    }

    // Prevent passengers from leaving completed/cancelled rides
    if (
      user.id !== ride.creator &&
      (ride.status === "completed" || ride.status === "cancelled")
    ) {
      throw new Error("Cannot leave a completed or cancelled ride");
    }

    try {
      // If user is the creator, cancel the entire ride
      if (ride.creator === user.id) {
        const updatedRide = {
          ...ride,
          status: "cancelled" as RideStatus,
        };

        setRides((prevRides) =>
          prevRides.map((r) => (r.id === rideId ? updatedRide : r)),
        );

        publishEvent("rides", "update", updatedRide);

        try {
          await updateRideStatus(rideId, "cancelled");
        } catch (dbError) {
          console.error("Error updating ride status:", dbError);
        }

        try {
          await notifyAllRidePassengers(
            rideId,
            `The ride to ${ride.destination.address} has been cancelled by the driver.`,
            "update",
          );
        } catch (notifyError) {
          console.error("Error notifying passengers:", notifyError);
        }
      } else {
        // If user is just a passenger, remove them from the ride
        const { data: currentRide, error: rideCheckError } = await supabase
          .from("ride_requests")
          .select("status, seats_available")
          .eq("id", rideId)
          .single();

        if (rideCheckError) {
          console.error("Error checking ride status:", rideCheckError);
          throw new Error(rideCheckError.message);
        }

        if (
          currentRide &&
          (currentRide.status === "completed" ||
            currentRide.status === "cancelled")
        ) {
          throw new Error(`Cannot leave a ${currentRide.status} ride`);
        }

        const { error: passengerError } = await supabase
          .from("ride_passengers")
          .delete()
          .eq("ride_id", rideId)
          .eq("user_id", user.id);

        if (passengerError) {
          console.error("Error removing passenger:", passengerError);
        }

        if (
          currentRide.status !== "completed" &&
          currentRide.status !== "cancelled"
        ) {
          const newSeatsAvailable = currentRide.seats_available + 1;

          const { error: rideError } = await supabase
            .from("ride_requests")
            .update({
              seats_available: newSeatsAvailable,
              status: "open",
            })
            .eq("id", rideId);

          if (rideError) {
            console.error("Error updating ride:", rideError);
          }
        }

        // Refresh user's rides
        await fetchRides();

        publishEvent("rides", "leave", { rideId, userId: user.id });
      }
    } catch (error) {
      console.error("Error in cancelRideRequest:", error);
      throw error;
    }
  };

  const completeRideRequest = async (rideId: string): Promise<void> => {
    if (!user) throw new Error("User must be logged in");

    const ride = rides.find((r) => r.id === rideId);
    if (!ride) throw new Error("Ride not found");

    if (ride.creator !== user.id) {
      throw new Error("Only the ride creator can complete a ride");
    }

    try {
      const updatedRide = {
        ...ride,
        status: "completed" as RideStatus,
      };

      setRides((prevRides) =>
        prevRides.map((r) => (r.id === rideId ? updatedRide : r)),
      );

      publishEvent("rides", "update", updatedRide);

      try {
        await updateRideStatus(rideId, "completed");
      } catch (dbError) {
        console.error("Error updating ride status:", dbError);
      }

      try {
        await notifyAllRidePassengers(
          rideId,
          `Your ride to ${ride.destination.address} has been completed.`,
          "update",
        );
      } catch (notifyError) {
        console.error("Error notifying passengers:", notifyError);
      }
    } catch (error) {
      console.error("Error in completeRideRequest:", error);
      throw error;
    }
  };

  // SECURE: Use server-side search instead of client-side filtering
  const findMatchingRides = async (
    startPoint: Location,
    endPoint: Location,
    vehicleFilter?: VehicleType | null,
  ): Promise<RideRequest[]> => {
    console.log("Searching for rides (secure server-side search)");
    try {
      const matchingRides = await searchRidesByRoute(
        startPoint.coordinates.lat,
        startPoint.coordinates.lng,
        endPoint.coordinates.lat,
        endPoint.coordinates.lng,
        1, // 1km radius
        vehicleFilter,
      );

      console.log(`Found ${matchingRides.length} matching rides`);
      return matchingRides;
    } catch (error) {
      console.error("Error searching rides:", error);
      return [];
    }
  };

  const syncRideStatus = async (rideId: string) => {
    try {
      const { data, error } = await supabase
        .from("ride_requests")
        .select("status, seats_available, vehicle")
        .eq("id", rideId)
        .single();

      if (error) {
        console.error("Error syncing ride status:", error);
        return;
      }

      if (!data) {
        console.warn("Ride not found for sync:", rideId);
        return;
      }

      const localRide = rides.find((r) => r.id === rideId);
      if (!localRide) {
        console.warn("Ride not in local state:", rideId);
        return;
      }

      if (
        localRide.status !== data.status ||
        localRide.seatsAvailable !== data.seats_available ||
        localRide.vehicle !== data.vehicle
      ) {
        const updatedRide = {
          ...localRide,
          status: data.status as RideStatus,
          seatsAvailable: data.seats_available,
          vehicle: data.vehicle as VehicleType,
        };

        setRides((prevRides) =>
          prevRides.map((r) => (r.id === rideId ? updatedRide : r)),
        );
      }
    } catch (error) {
      console.error("Error in syncRideStatus:", error);
    }
  };

  return (
    <RideContext.Provider
      value={{
        rides,
        userRides,
        loading,
        createRideRequest,
        joinRideRequest,
        cancelRideRequest,
        completeRideRequest,
        findMatchingRides,
        syncRideStatus,
        refreshUserRides,
      }}
    >
      {children}
    </RideContext.Provider>
  );
};

export const useRide = () => {
  const context = useContext(RideContext);
  if (context === undefined) {
    throw new Error("useRide must be used within a RideProvider");
  }
  return context;
};
