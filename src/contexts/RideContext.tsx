import React, { createContext, useContext, useState, useEffect } from "react";
import { RideRequest, Location, RideStatus } from "../types";
import { useAuth } from "./AuthContext";
import { useAbly } from "./AblyContext";
import { supabase } from "../lib/supabase";
import { notifyAllRidePassengers } from "../lib/notifications";
import { updateRideStatus } from "../lib/database";

interface RideContextType {
  rides: RideRequest[];
  userRides: RideRequest[];
  loading: boolean;
  createRideRequest: (
    startingPoint: Location,
    destination: Location,
    totalSeats: number,
    contactPhone: string,
    vehicle: VehicleType
  ) => Promise<RideRequest>;
  joinRideRequest: (rideId: string, contactPhone: string) => Promise<void>;
  cancelRideRequest: (rideId: string) => Promise<void>;
  completeRideRequest: (rideId: string) => Promise<void>;
  findMatchingRides: (
    startPoint: Location,
    endPoint: Location
  ) => RideRequest[];
  syncRideStatus: (rideId: string) => Promise<void>;
  refreshAllRides: () => Promise<void>;
}

const RideContext = createContext<RideContextType | undefined>(undefined);

export const RideProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [rides, setRides] = useState<RideRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();
  const { publishEvent, subscribeToEvent } = useAbly();

  // Function to fetch all rides (can be called directly)
  const fetchRides = async () => {
    console.log("Fetching all rides from the database");
    try {
      // With RLS enabled, this will only return rides the user can access
      const { data, error } = await supabase.from("ride_requests").select(`
          id,
          creator_id,
          starting_point,
          destination,
          seats_available,
          total_seats,
          status,
          created_at
        `);

      if (error) {
        console.error("Error fetching rides:", error);
        return;
      }

      if (data) {
        console.log(`Fetched ${data.length} rides from database`);
        // Transform data to match our RideRequest type
        const transformedRides = await Promise.all(
          data.map(async (ride) => {
            // Fetch passengers for each ride
            const { data: passengers, error: passengersError } = await supabase
              .from("ride_passengers")
              .select("user_id")
              .eq("ride_id", ride.id);

            if (passengersError) {
              console.error("Error fetching passengers:", passengersError);
              return null;
            }

            const passengerIds = passengers
              ? passengers.map((p) => p.user_id)
              : [];

            return {
              id: ride.id,
              creator: ride.creator_id,
              startingPoint: ride.starting_point as Location,
              destination: ride.destination as Location,
              seatsAvailable: ride.seats_available,
              totalSeats: ride.total_seats,
              passengers: passengerIds,
              status: ride.status as RideStatus,
              createdAt: ride.created_at,
            };
          })
        );

        // Filter out any null values that might have come from errors
        const validRides = transformedRides.filter(Boolean) as RideRequest[];
        console.log(`Processed ${validRides.length} valid rides`);
        setRides(validRides);
      }
    } catch (error) {
      console.error("Error in ride fetching process:", error);
    } finally {
      setLoading(false);
    }
  };

  // Public function to refresh all rides from the database
  const refreshAllRides = async () => {
    console.log("Manual refresh of all rides requested");
    await fetchRides();
  };

  // Load rides from Supabase
  useEffect(() => {
    fetchRides();

    // Set up subscription for real-time updates with immediate fetch of updated data
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
          console.log("Ride update detected:", payload);
          // Immediately fetch the updated ride to ensure we have the latest status
          if (
            payload.new &&
            typeof payload.new === "object" &&
            "id" in payload.new
          ) {
            supabase
              .from("ride_requests")
              .select("*")
              .eq("id", payload.new.id)
              .single()
              .then(({ data, error }) => {
                if (error) {
                  console.error("Error fetching updated ride:", error);
                  return;
                }

                if (data) {
                  console.log("Updated ride data from DB:", data);
                  // Force a full refetch to ensure everything is in sync
                  fetchRides();
                }
              });
          } else {
            // If we can't get specific ride ID, refetch all rides
            fetchRides();
          }
        }
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
          console.log("Passenger update detected:", payload);
          // Always fetch all rides when passengers change to ensure correct state
          fetchRides();
        }
      )
      .subscribe();

    // Add Ably event subscription for sync events
    let unsubscribeSync = () => {};

    if (subscribeToEvent) {
      unsubscribeSync = subscribeToEvent("rides", "sync", () => {
        console.log("Sync event received, fetching all rides");
        // Immediate full refresh
        fetchRides();
      });
    }

    return () => {
      supabase.removeChannel(rideSubscription);
      supabase.removeChannel(passengerSubscription);
      if (unsubscribeSync) unsubscribeSync();
    };
  }, [user]); // Only depend on user, not on useAbly

  // Filter rides that the current user is part of
  const userRides = rides.filter(
    (ride) =>
      user && (ride.creator === user.id || ride.passengers.includes(user.id))
  );

const createRideRequest = async (
    startingPoint: Location,
    destination: Location,
    totalSeats: number,
    contactPhone: string,
    vehicle: VehicleType
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
        console.error("Error adding passenger:", passengerError);
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

      console.log("New ride created with ID:", newRide.id);

      // Emit Ably event for real-time updates
      publishEvent("rides", "new", newRide);

      // Multiple sync events with increasing delay to ensure delivery
      const syncPayload = {
        timestamp: new Date().toISOString(),
        rideId: newRide.id,
        action: "create",
      };

      // Send multiple sync events with increasing delays to ensure delivery
      publishEvent("rides", "sync", syncPayload);

      // Staggered sync events to ensure clients receive the update
      setTimeout(() => {
        publishEvent("rides", "sync", {
          ...syncPayload,
          retry: 1,
        });
      }, 500);

      setTimeout(() => {
        publishEvent("rides", "sync", {
          ...syncPayload,
          retry: 2,
        });
      }, 1500);

      setTimeout(() => {
        publishEvent("rides", "sync", {
          ...syncPayload,
          retry: "final",
        });
      }, 3000);

      return newRide;
    } catch (error) {
      console.error("Error creating ride:", error);
      throw error;
    }
  };

  const joinRideRequest = async (
    rideId: string,
    contactPhone: string
  ): Promise<void> => {
    if (!user) throw new Error("User must be logged in");

    // Find ride
    const ride = rides.find((r) => r.id === rideId);
    if (!ride) throw new Error("Ride not found");

    // Check if user is already in the ride
    if (ride.passengers.includes(user.id)) {
      throw new Error("You are already in this ride");
    }

    // Check if ride is full
    if (ride.seatsAvailable <= 0 || ride.status !== "open") {
      throw new Error("This ride is no longer available");
    }

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

      // Update ride available seats
      const newSeatsAvailable = ride.seatsAvailable - 1;
      const newStatus = newSeatsAvailable <= 0 ? "full" : "open";

      const { error: rideError } = await supabase.from("ride_requests").upsert({
        id: rideId,
        creator_id: ride.creator,
        starting_point: ride.startingPoint,
        destination: ride.destination,
        seats_available: newSeatsAvailable,
        total_seats: ride.totalSeats,
        status: newStatus,
      });

      if (rideError) {
        console.error("Error updating ride:", rideError);
        throw new Error(rideError.message);
      }

      // Update local state
      const updatedRide = {
        ...ride,
        seatsAvailable: newSeatsAvailable,
        status: newStatus as RideStatus,
        passengers: [...ride.passengers, user.id],
      };

      setRides((prevRides) =>
        prevRides.map((r) => (r.id === rideId ? updatedRide : r))
      );

      // Emit Ably events
      publishEvent("rides", "update", updatedRide);
      publishEvent("rides", "join", updatedRide);
    } catch (error) {
      console.error("Error joining ride:", error);
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

    // Add guard clause - prevent passengers from leaving completed/cancelled rides
    if (
      user.id !== ride.creator &&
      (ride.status === "completed" || ride.status === "cancelled")
    ) {
      throw new Error("Cannot leave a completed or cancelled ride");
    }

    console.log(
      `Canceling/leaving ride ${rideId}, status: ${ride.status}, user: ${user.id}, creator: ${ride.creator}`
    );

    try {
      // If user is the creator, cancel the entire ride
      if (ride.creator === user.id) {
        // Update local state immediately for better UX
        const updatedRide = {
          ...ride,
          status: "cancelled" as RideStatus,
        };

        // Update rides in local state immediately
        setRides((prevRides) =>
          prevRides.map((r) => (r.id === rideId ? updatedRide : r))
        );

        console.log(
          "Emitting ride update event for cancelled ride:",
          updatedRide
        );
        // Emit Ably event
        publishEvent("rides", "update", updatedRide);

        // Try to update the backend status
        try {
          // Use the utility function to update ride status
          await updateRideStatus(rideId, "cancelled");
          console.log(
            "Successfully updated ride status to cancelled in database"
          );
        } catch (dbError) {
          console.error("Error updating ride status in database:", dbError);
          // We continue anyway as the local state is already updated
        }

        // Notify all passengers that the ride has been cancelled
        try {
          await notifyAllRidePassengers(
            rideId,
            `The ride to ${ride.destination.address} has been cancelled by the driver.`,
            "update"
          );
        } catch (notifyError) {
          console.error("Error notifying passengers:", notifyError);
          // Continue execution even if notification fails
        }
      } else {
        // If user is just a passenger, remove them from the ride
        console.log(
          `Passenger ${user.id} leaving ride ${rideId} with status ${ride.status}`
        );

        // First verify the current ride status directly from the database
        const { data: currentRide, error: rideCheckError } = await supabase
          .from("ride_requests")
          .select("status")
          .eq("id", rideId)
          .single();

        if (rideCheckError) {
          console.error("Error checking current ride status:", rideCheckError);
          throw new Error(rideCheckError.message);
        }

        // Double-check if ride is completed or cancelled in the database
        if (
          currentRide &&
          (currentRide.status === "completed" ||
            currentRide.status === "cancelled")
        ) {
          console.log(
            `Confirmed ride ${rideId} has ${currentRide.status} status in database, blocking status change`
          );
          throw new Error(`Cannot leave a ${currentRide.status} ride`);
        }

        const { error: passengerError } = await supabase
          .from("ride_passengers")
          .delete()
          .eq("ride_id", rideId)
          .eq("user_id", user.id);

        if (passengerError) {
          console.error("Error removing passenger:", passengerError);
          throw new Error(passengerError.message);
        }

        // Only update ride status if it's not already completed or cancelled
        if (ride.status !== "completed" && ride.status !== "cancelled") {
          console.log(
            `Updating ride status for active ride, setting seats_available to ${
              ride.seatsAvailable + 1
            }`
          );

          // Update ride available seats
          const { error: rideError } = await supabase
            .from("ride_requests")
            .upsert({
              id: rideId,
              creator_id: ride.creator,
              starting_point: ride.startingPoint,
              destination: ride.destination,
              seats_available: ride.seatsAvailable + 1,
              total_seats: ride.totalSeats,
              status: "open",
            });

          if (rideError) {
            console.error("Error updating ride:", rideError);
            throw new Error(rideError.message);
          }

          // Update local state
          const updatedRide = {
            ...ride,
            seatsAvailable: ride.seatsAvailable + 1,
            status: "open" as RideStatus,
            passengers: ride.passengers.filter((id) => id !== user.id),
          };

          setRides((prevRides) =>
            prevRides.map((r) => (r.id === rideId ? updatedRide : r))
          );

          // Emit Ably event
          publishEvent("rides", "update", updatedRide);

          // If user was a passenger and not the creator, emit leave event
          if (ride.creator !== user.id && ride.passengers.includes(user.id)) {
            publishEvent("rides", "leave", updatedRide);
          }
        } else {
          console.log(`NOT updating ride status for ${ride.status} ride`);

          // If ride was already completed or cancelled, just remove the passenger without changing status
          // Update local state
          const updatedRide = {
            ...ride,
            passengers: ride.passengers.filter((id) => id !== user.id),
          };

          setRides((prevRides) =>
            prevRides.map((r) => (r.id === rideId ? updatedRide : r))
          );

          // Still emit a leave event so the UI can update
          publishEvent("rides", "leave", updatedRide);
        }
      }
    } catch (error) {
      console.error("Error canceling ride:", error);
      throw error;
    }
  };

  const completeRideRequest = async (rideId: string): Promise<void> => {
    if (!user) throw new Error("User must be logged in");

    // Find ride
    const ride = rides.find((r) => r.id === rideId);
    if (!ride) throw new Error("Ride not found");

    // Check if user is the creator
    if (ride.creator !== user.id) {
      throw new Error("Only the ride creator can complete a ride");
    }

    try {
      // Update local state immediately for better UX
      const updatedRide = {
        ...ride,
        status: "completed" as RideStatus,
      };

      // Update rides in local state immediately
      setRides((prevRides) =>
        prevRides.map((r) => (r.id === rideId ? updatedRide : r))
      );

      console.log(
        "Emitting ride update event for completed ride:",
        updatedRide
      );
      // Emit Ably event
      publishEvent("rides", "update", updatedRide);

      // Try to update the backend status
      try {
        // Use the utility function to update ride status
        await updateRideStatus(rideId, "completed");
      } catch (dbError) {
        console.error("Error updating ride status in database:", dbError);
        // We continue anyway as the local state is already updated
      }

      // Notify all passengers that the ride has been completed
      try {
        await notifyAllRidePassengers(
          rideId,
          `Your ride to ${ride.destination.address} has been completed.`,
          "update"
        );
      } catch (notifyError) {
        console.error("Error notifying passengers:", notifyError);
        // Continue execution even if notification fails
      }
    } catch (error) {
      console.error("Error completing ride:", error);
      throw error;
    }
  };

  const calculateDistance = (loc1: Location, loc2: Location): number => {
    // Simple Euclidean distance calculation
    const latDiff = loc1.coordinates.lat - loc2.coordinates.lat;
    const lngDiff = loc1.coordinates.lng - loc2.coordinates.lng;
    return Math.sqrt(latDiff * latDiff + lngDiff * lngDiff);
  };

  const findMatchingRides = (
    startPoint: Location,
    endPoint: Location
  ): RideRequest[] => {
    // Find rides where both starting point and destination are within 1km of the given points
    return rides.filter(
      (ride) =>
        ride.status === "open" &&
        calculateDistance(ride.startingPoint, startPoint) <= 0.01 && // Approx 1km in latitude/longitude
        calculateDistance(ride.destination, endPoint) <= 0.01
    );
  };

  const syncRideStatus = async (rideId: string) => {
    console.log(`Syncing ride status for ride ${rideId}`);
    try {
      // Get the ride status directly from the database
      const { data, error } = await supabase
        .from("ride_requests")
        .select("status, seats_available")
        .eq("id", rideId)
        .single();

      if (error) {
        console.error(`Error fetching ride ${rideId} for status sync:`, error);
        return;
      }

      if (!data) {
        console.warn(`Ride ${rideId} not found for status sync`);
        return;
      }

      console.log(
        `Database status for ride ${rideId}: ${data.status}, seats: ${data.seats_available}`
      );

      // Find the ride in local state
      const localRide = rides.find((r) => r.id === rideId);
      if (!localRide) {
        console.warn(`Ride ${rideId} not found in local state for status sync`);
        return;
      }

      // Check if status needs to be updated
      if (
        localRide.status !== data.status ||
        localRide.seatsAvailable !== data.seats_available
      ) {
        console.log(
          `Updating local ride ${rideId} status from ${localRide.status} to ${data.status}`
        );

        // Update local state to match database
        const updatedRide = {
          ...localRide,
          status: data.status as RideStatus,
          seatsAvailable: data.seats_available,
        };

        setRides((prevRides) =>
          prevRides.map((r) => (r.id === rideId ? updatedRide : r))
        );
      }
    } catch (error) {
      console.error(`Error syncing ride ${rideId} status:`, error);
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
        refreshAllRides,
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
