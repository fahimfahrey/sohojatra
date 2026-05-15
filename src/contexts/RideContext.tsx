import React, { createContext, useContext, useState, useEffect } from "react";
import { RideRequest, Location, VehicleType, RideStatus } from "../types";
import { useAuth } from "./AuthContext";
import { useAbly } from "./AblyContext";
import { supabase } from "../lib/supabase";
import { updateRideStatus } from "../lib/database";
import { notifyAllRidePassengers } from "../lib/notifications";


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
    endPoint: Location,
    vehicleFilter?: VehicleType | null
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
  const fetchRides = async () => {    try {
      // With RLS enabled, this will only return rides the user can access
      const { data, error } = await supabase.from("ride_requests").select(`
          id,
          creator_id,
          starting_point,
          destination,
          seats_available,
          total_seats,
          status,
          created_at,
          vehicle,
          contact_phone
        `);

      if (error) {        return;
      }

      if (data) {        // Transform data to match our RideRequest type
        const transformedRides = await Promise.all(
          data.map(async (ride) => {
            // Fetch passengers for each ride
            const { data: passengers, error: passengersError } = await supabase
              .from("ride_passengers")
              .select("user_id")
              .eq("ride_id", ride.id);

            if (passengersError) {            }

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
              vehicle: ride.vehicle as VehicleType,
              contactPhone: ride.contact_phone,
            };
          })
        );

        // Filter out any null values that might have come from errors
        const validRides = transformedRides.filter(Boolean) as RideRequest[];        setRides(validRides);
      }
    } catch (error) {    } finally {
      setLoading(false);
    }
  };

  // Public function to refresh all rides from the database
  const refreshAllRides = async () => {    await fetchRides();
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
        (payload) => {          // Immediately fetch the updated ride to ensure we have the latest status
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
                if (error) {                  return;
                }

                if (data) {                  // Update the specific ride in our state
                  setRides((prevRides) =>
                    prevRides.map((ride) =>
                      ride.id === data.id
                        ? {
                            ...ride,
                            status: data.status,
                            seatsAvailable: data.seats_available,
                            vehicle: data.vehicle,
                          }
                        : ride
                    )
                  );
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
        (payload) => {          // Always fetch all rides when passengers change to ensure correct state
          fetchRides();
        }
      )
      .subscribe();

    // Add Ably event subscription for sync events
    let unsubscribeSync = () => {};

    if (subscribeToEvent) {
      unsubscribeSync = subscribeToEvent("rides", "sync", () => {        // Immediate full refresh
        fetchRides();
      });
    }

    return () => {
      supabase.removeChannel(rideSubscription);
      supabase.removeChannel(passengerSubscription);
      if (unsubscribeSync) unsubscribeSync();
    };
  }, [user, subscribeToEvent]); // Include subscribeToEvent in dependencies

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

      if (rideError) {        throw new Error(rideError.message);
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

      if (passengerError) {        throw new Error(passengerError.message);
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
    } catch (error) {      throw error;
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

      if (passengerError) {        throw new Error(passengerError.message);
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
        vehicle: ride.vehicle,
      });

      if (rideError) {        throw new Error(rideError.message);
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
    } catch (error) {      throw error;
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
        );        // Emit Ably event
        publishEvent("rides", "update", updatedRide);

        // Try to update the backend status
        try {
          // Use the utility function to update ride status
          await updateRideStatus(rideId, "cancelled");        } catch (dbError) {          // We continue anyway as the local state is already updated
        }

        // Notify all passengers that the ride has been cancelled
        try {
          await notifyAllRidePassengers(
            rideId,
            `The ride to ${ride.destination.address} has been cancelled by the driver.`,
            "update"
          );
        } catch (notifyError) {          // Continue execution even if notification fails
        }
      } else {
        // If user is just a passenger, remove them from the ride
        // First verify the current ride status directly from the database
        const { data: currentRide, error: rideCheckError } = await supabase
          .from("ride_requests")
          .select("status")
          .eq("id", rideId)
          .single();

        if (rideCheckError) {          throw new Error(rideCheckError.message);
        }

        // Double-check if ride is completed or cancelled in the database
        if (
          currentRide &&
          (currentRide.status === "completed" ||
            currentRide.status === "cancelled")
        ) {          throw new Error(`Cannot leave a ${currentRide.status} ride`);
        }

        const { error: passengerError } = await supabase
          .from("ride_passengers")
          .delete()
          .eq("ride_id", rideId)
          .eq("user_id", user.id);

        if (passengerError) {        }

        // Only update ride status if it's not already completed or cancelled
        if (ride.status !== "completed" && ride.status !== "cancelled") {
          const newSeatsAvailable = ride.seatsAvailable + 1;
          const newStatus = "open";
          const newPassengers = ride.passengers.filter((p) => p !== user.id);

          const { error: rideError } = await supabase
            .from("ride_requests")
            .upsert({
              id: rideId,
              creator_id: ride.creator,
              starting_point: ride.startingPoint,
              destination: ride.destination,
              seats_available: newSeatsAvailable,
              total_seats: ride.totalSeats,
              status: newStatus,
              vehicle: ride.vehicle,
            });

          if (rideError) {          }

          // Update local state
          const updatedRide = {
            ...ride,
            seatsAvailable: newSeatsAvailable,
            status: newStatus as RideStatus,
            passengers: newPassengers,
          };

          setRides((prevRides) =>
            prevRides.map((r) => (r.id === rideId ? updatedRide : r))
          );

          // Emit Ably events
          publishEvent("rides", "update", updatedRide);
          publishEvent("rides", "leave", updatedRide);
        } else {          
          // Just remove the passenger from local state without changing seat availability
          const newPassengers = ride.passengers.filter((p) => p !== user.id);
          const updatedRide = {
            ...ride,
            passengers: newPassengers,
          };

          setRides((prevRides) =>
            prevRides.map((r) => (r.id === rideId ? updatedRide : r))
          );

          publishEvent("rides", "leave", updatedRide);
        }
      }
    } catch (error) {      throw error;
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
      );      // Emit Ably event
      publishEvent("rides", "update", updatedRide);

      // Try to update the backend status
      try {
        // Use the utility function to update ride status
        await updateRideStatus(rideId, "completed");
      } catch (dbError) {        // We continue anyway as the local state is already updated
      }

      // Notify all passengers that the ride has been completed
      try {
        await notifyAllRidePassengers(
          rideId,
          `Your ride to ${ride.destination.address} has been completed.`,
          "update"
        );
      } catch (notifyError) {        // Continue execution even if notification fails
      }
    } catch (error) {      throw error;
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
    endPoint: Location,
    vehicleFilter?: VehicleType | null
  ): RideRequest[] => {    
    // Find rides where both starting point and destination are within 1km of the given points
    let matchingRides = rides.filter(
      (ride) =>
        ride.status === "open" &&
        calculateDistance(ride.startingPoint, startPoint) <= 0.01 && // Approx 1km in latitude/longitude
        calculateDistance(ride.destination, endPoint) <= 0.01
    );

    // Apply vehicle filter if specified
    if (vehicleFilter) {
      matchingRides = matchingRides.filter(
        (ride) => ride.vehicle === vehicleFilter
      );    }

    return matchingRides;
  };

  const syncRideStatus = async (rideId: string) => {    try {
      // Get the ride status directly from the database
      const { data, error } = await supabase
        .from("ride_requests")
        .select("status, seats_available, vehicle")
        .eq("id", rideId)
        .single();

      if (error) {        return;
      }

      if (!data) {        return;
      }
      // Find the ride in local state
      const localRide = rides.find((r) => r.id === rideId);
      if (!localRide) {        return;
      }

      // Check if status needs to be updated
      if (
        localRide.status !== data.status ||
        localRide.seatsAvailable !== data.seats_available ||
        localRide.vehicle !== data.vehicle
      ) {
        // Update local state to match database
        const updatedRide = {
          ...localRide,
          status: data.status as RideStatus,
          seatsAvailable: data.seats_available,
          vehicle: data.vehicle as VehicleType,
        };

        setRides((prevRides) =>
          prevRides.map((r) => (r.id === rideId ? updatedRide : r))
        );
      }
    } catch (error) {    }
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