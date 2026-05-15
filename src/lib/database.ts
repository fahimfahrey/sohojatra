import { supabase } from "./supabase";
import { Location, RideStatus } from "../types";
import {
  showBrowserNotification,
  isMobileDevice,
  isNotificationSupported,
} from "./browserNotifications";
import { VehicleType } from "../types";

/**
 * Search for rides matching a route with server-side filtering
 * This prevents exposing all ride data to the client
 * @param startLat Starting point latitude
 * @param startLng Starting point longitude
 * @param destLat Destination latitude
 * @param destLng Destination longitude
 * @param radiusKm Search radius in kilometers (default 1km)
 * @param vehicleType Optional vehicle filter
 * @returns Array of matching rides only
 */
export const searchRidesByRoute = async (
  startLat: number,
  startLng: number,
  destLat: number,
  destLng: number,
  radiusKm: number = 1,
  vehicleType?: VehicleType | null,
) => {
  try {
    // Convert km to approximate lat/lng degrees (1 degree ≈ 111km)
    const radiusDegrees = radiusKm / 111;

    // Build the query with server-side filtering
    let query = supabase
      .from("ride_requests")
      .select(
        `
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
      `,
      )
      .eq("status", "open"); // Only return open rides

    // Add vehicle filter if specified
    if (vehicleType) {
      query = query.eq("vehicle", vehicleType);
    }

    const { data, error } = await query;

    if (error) throw error;

    // Client-side filtering for proximity (since PostgREST doesn't have built-in geo functions)
    // In production, you should use PostGIS extension for proper geo queries
    const matchingRides = (data || []).filter((ride) => {
      const startPoint = ride.starting_point as Location;
      const destPoint = ride.destination as Location;

      const startDistance = Math.sqrt(
        Math.pow(startPoint.coordinates.lat - startLat, 2) +
          Math.pow(startPoint.coordinates.lng - startLng, 2),
      );

      const destDistance = Math.sqrt(
        Math.pow(destPoint.coordinates.lat - destLat, 2) +
          Math.pow(destPoint.coordinates.lng - destLng, 2),
      );

      return startDistance <= radiusDegrees && destDistance <= radiusDegrees;
    });

    // Fetch passengers only for matching rides
    const ridesWithPassengers = await Promise.all(
      matchingRides.map(async (ride) => {
        const { data: passengers } = await supabase
          .from("ride_passengers")
          .select("user_id")
          .eq("ride_id", ride.id);

        return {
          id: ride.id,
          creator: ride.creator_id,
          startingPoint: ride.starting_point as Location,
          destination: ride.destination as Location,
          seatsAvailable: ride.seats_available,
          totalSeats: ride.total_seats,
          passengers: passengers?.map((p) => p.user_id) || [],
          status: ride.status as RideStatus,
          createdAt: ride.created_at,
          vehicle: ride.vehicle as VehicleType,
          contactPhone: ride.contact_phone,
        };
      }),
    );

    return ridesWithPassengers;
  } catch (error) {
    console.error("Error searching rides:", error);
    throw error;
  }
};

/**
 * Fetch only rides that the current user is part of (created or joined)
 * This is secure and doesn't expose other users' rides
 */
export const fetchUserRides = async (userId: string) => {
  try {
    // Get rides where user is the creator
    const { data: createdRides, error: createdError } = await supabase
      .from("ride_requests")
      .select(
        `
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
      `,
      )
      .eq("creator_id", userId);

    if (createdError) throw createdError;

    // Get rides where user is a passenger
    const { data: joinedRideIds, error: joinedError } = await supabase
      .from("ride_passengers")
      .select("ride_id")
      .eq("user_id", userId);

    if (joinedError) throw joinedError;

    const joinedIds = joinedRideIds?.map((r) => r.ride_id) || [];

    let joinedRides: any[] = [];
    if (joinedIds.length > 0) {
      const { data, error } = await supabase
        .from("ride_requests")
        .select(
          `
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
        `,
        )
        .in("id", joinedIds);

      if (error) throw error;
      joinedRides = data || [];
    }

    // Combine and deduplicate
    const allRideIds = new Set([
      ...(createdRides || []).map((r) => r.id),
      ...joinedRides.map((r) => r.id),
    ]);

    const allRides = [...(createdRides || []), ...joinedRides].filter(
      (ride, index, self) => self.findIndex((r) => r.id === ride.id) === index,
    );

    // Fetch passengers for user's rides
    const { data: allPassengers } = await supabase
      .from("ride_passengers")
      .select("ride_id, user_id")
      .in("ride_id", Array.from(allRideIds));

    const passengersByRide = new Map<string, string[]>();
    (allPassengers || []).forEach((p) => {
      if (!passengersByRide.has(p.ride_id)) {
        passengersByRide.set(p.ride_id, []);
      }
      passengersByRide.get(p.ride_id)!.push(p.user_id);
    });

    return allRides.map((ride) => ({
      id: ride.id,
      creator: ride.creator_id,
      startingPoint: ride.starting_point as Location,
      destination: ride.destination as Location,
      seatsAvailable: ride.seats_available,
      totalSeats: ride.total_seats,
      passengers: passengersByRide.get(ride.id) || [],
      status: ride.status as RideStatus,
      createdAt: ride.created_at,
      vehicle: ride.vehicle as VehicleType,
      contactPhone: ride.contact_phone,
    }));
  } catch (error) {
    console.error("Error fetching user rides:", error);
    throw error;
  }
};

export const fetchAllRides = async () => {
  try {
    const { data, error } = await supabase
      .from("ride_requests")
      .select(
        `
        id,
        creator_id,
        starting_point,
        destination,
        seats_available,
        total_seats,
        status,
        vehicle,
        contact_phone,
        created_at,
        updated_at
      `,
      )
      .order("created_at", { ascending: false });

    if (error) throw error;

    const transformedData = await Promise.all(
      (data || []).map(async (ride) => {
        const passengers = await fetchRidePassengers(ride.id);
        return {
          id: ride.id,
          creator: ride.creator_id,
          starting_point: ride.starting_point,
          destination: ride.destination,
          seats_available: ride.seats_available,
          total_seats: ride.total_seats,
          status: ride.status,
          vehicle: ride.vehicle,
          contact_phone: ride.contact_phone,
          created_at: ride.created_at,
          updated_at: ride.updated_at,
          passengers,
        };
      }),
    );

    return transformedData;
  } catch (error) {
    throw error;
  }
};

export const fetchRidesByVehicle = async (vehicleType: VehicleType) => {
  try {
    const { data, error } = await supabase
      .from("ride_requests")
      .select("*")
      .eq("vehicle", vehicleType)
      .eq("status", "open")
      .order("created_at", { ascending: false });

    if (error) throw error;
    return data || [];
  } catch (error) {
    throw error;
  }
};

export const fetchRideById = async (rideId: string) => {
  const { data, error } = await supabase
    .from("ride_requests")
    .select(
      `
      id,
      creator_id,
      starting_point,
      destination,
      seats_available,
      total_seats,
      status,
      created_at,
      updated_at
    `,
    )
    .eq("id", rideId)
    .single();

  if (error) {
    throw error;
  }

  return data;
};

export const fetchRidePassengers = async (rideId: string) => {
  const { data, error } = await supabase
    .from("ride_passengers")
    .select("user_id")
    .eq("ride_id", rideId);

  if (error) {
    throw error;
  }

  return data?.map((p) => p.user_id) || [];
};

export const fetchRidePassengersWithDetails = async (rideId: string) => {
  const { data, error } = await supabase
    .from("ride_passengers")
    .select("user_id, encrypted_phone")
    .eq("ride_id", rideId);

  if (error) {
    throw error;
  }

  return data || [];
};

export const createRide = async (
  creatorId: string,
  startingPoint: Location,
  destination: Location,
  totalSeats: number,
  contactPhone: string,
  vehicle: VehicleType,
) => {
  // Insert the ride
  const { data, error } = await supabase
    .from("ride_requests")
    .insert({
      creator_id: creatorId,
      starting_point: startingPoint,
      destination,
      seats_available: totalSeats - 1, // Creator takes one seat
      total_seats: totalSeats,
      vehicle: vehicle,
      status: "open",
      contact_phone: contactPhone,
    })
    .select()
    .single();

  if (error) {
    throw error;
  }

  // Add creator as a passenger
  // Phone number will be encrypted by database trigger
  const { error: passengerError } = await supabase
    .from("ride_passengers")
    .insert({
      ride_id: data.id,
      user_id: creatorId,
      contact_phone: contactPhone, // Encrypted by database trigger
    });

  if (passengerError) {
    throw passengerError;
  }

  return data;
};

export const joinRide = async (
  rideId: string,
  userId: string,
  contactPhone: string,
) => {
  // Add user as passenger
  // Phone number will be encrypted by database trigger
  const { error: passengerError } = await supabase
    .from("ride_passengers")
    .insert({
      ride_id: rideId,
      user_id: userId,
      contact_phone: contactPhone, // Encrypted by database trigger
    });

  if (passengerError) {
    throw passengerError;
  }

  // Get current ride to check seat availability
  const { data: ride, error: rideError } = await supabase
    .from("ride_requests")
    .select("seats_available")
    .eq("id", rideId)
    .single();

  if (rideError) {
    throw rideError;
  }

  // Update seats and potentially status
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
    throw updateError;
  }

  return { newSeatsAvailable, newStatus };
};

// Notifications
export const fetchUserNotifications = async (userId: string) => {
  const { data, error } = await supabase
    .from("notifications")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  return data;
};

export const createNotification = async (
  userId: string,
  message: string,
  type: string,
  rideId?: string,
) => {
  const { data, error } = await supabase
    .from("notifications")
    .insert({
      user_id: userId,
      message,
      type,
      read: false,
      ride_id: rideId,
    })
    .select()
    .single();

  if (error) {
    throw error;
  }

  // Try to send browser notification if in browser environment
  if (typeof window !== "undefined") {
    const isMobile = isMobileDevice();
    const notificationsSupported = isNotificationSupported();

    // Only attempt to show browser notifications if supported
    if (notificationsSupported) {
      const icon = "/banner_image.png";
      let redirectPath = "/notifications";

      // Add ride-specific redirect if available
      if (rideId) {
        redirectPath = `/rides/${rideId}`; // Updated to match the actual ride URL format
      }

      showBrowserNotification("Sohojatra Notification", {
        body: message,
        icon,
        requireInteraction: !isMobile, // Don't require interaction on mobile
        actions: isMobile
          ? []
          : [
              {
                action: "redirect",
                title: "View Details",
                deepLink: redirectPath,
              },
            ],
        data: {
          redirectPath,
          notificationId: data.id,
          type,
        },
      }).catch(() => {
        // Silently fail if notification cannot be shown
      });
    }
  }

  return data;
};

export const markNotificationAsRead = async (
  notificationId: string,
  userId: string,
) => {
  const { error } = await supabase
    .from("notifications")
    .update({ read: true })
    .eq("id", notificationId)
    .eq("user_id", userId);

  if (error) {
    throw error;
  }
};

export const markAllNotificationsAsRead = async (userId: string) => {
  const { error } = await supabase
    .from("notifications")
    .update({ read: true })
    .eq("user_id", userId)
    .eq("read", false);

  if (error) {
    throw error;
  }
};

export const updateRideStatus = async (
  rideId: string,
  status: RideStatus,
  preserveFields = true,
) => {
  try {
    // First, get the current ride data if we want to preserve fields
    let existingData = {};
    if (preserveFields) {
      try {
        const { data, error } = await supabase
          .from("ride_requests")
          .select("*")
          .eq("id", rideId)
          .single();

        if (error) {
          // Continue with minimal data instead of throwing
        } else if (data) {
          existingData = data;

          // Protection: Don't allow completed or cancelled rides to change back to open
          if (
            (data.status === "completed" || data.status === "cancelled") &&
            (status === "open" || status === "full")
          ) {
            return data; // Return existing data without making changes
          }
        }
      } catch (fetchError) {
        // Continue with minimal data instead of throwing
      }
    }

    // Ensure we at least have the required fields
    const updateData = {
      ...existingData,
      id: rideId,
      status,
    };

    // Update the ride status - use upsert (PUT) instead of update (PATCH) to avoid CORS issues
    const { data, error } = await supabase
      .from("ride_requests")
      .upsert(updateData)
      .select();

    if (error) {
      throw error;
    }

    return data?.[0] || updateData;
  } catch (error) {
    throw error;
  }
};
