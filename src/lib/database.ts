import { supabase } from "./supabase";
import { Location, RideStatus } from "../types";
import {
  showBrowserNotification,
  isMobileDevice,
  isNotificationSupported,
} from "./browserNotifications";
import { VehicleType } from "../types";

export const fetchAllRides = async () => {
  try {
    const { data, error } = await supabase
      .from("ride_requests")
      .select(`
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
      `)
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
          passengers
        };
      })
    );

    return transformedData;
  } catch (error) {
    console.error("Error fetching rides:", error);
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
    console.error("Error fetching rides by vehicle:", error);
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
    `
    )
    .eq("id", rideId)
    .single();

  if (error) {
    console.error(`Error fetching ride ${rideId}:`, error);
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
    console.error(`Error fetching passengers for ride ${rideId}:`, error);
    throw error;
  }

  return data?.map((p) => p.user_id) || [];
};

export const fetchRidePassengersWithDetails = async (rideId: string) => {
  const { data, error } = await supabase
    .from("ride_passengers")
    .select("user_id, contact_phone")
    .eq("ride_id", rideId);

  if (error) {
    console.error(`Error fetching passengers for ride ${rideId}:`, error);
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
  vehicle: VehicleType
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
    console.error("Error creating ride:", error);
    throw error;
  }

  // Add creator as a passenger
  const { error: passengerError } = await supabase
    .from("ride_passengers")
    .insert({
      ride_id: data.id,
      user_id: creatorId,
    });

  if (passengerError) {
    console.error("Error adding creator as passenger:", passengerError);
    throw passengerError;
  }

  return data;
};

export const joinRide = async (
  rideId: string,
  userId: string,
  contactPhone: string
) => {
  // Add user as passenger
  const { error: passengerError } = await supabase
    .from("ride_passengers")
    .insert({
      ride_id: rideId,
      user_id: userId,
      contact_phone: contactPhone,
    });

  if (passengerError) {
    console.error("Error joining ride:", passengerError);
    throw passengerError;
  }

  // Get current ride to check seat availability
  const { data: ride, error: rideError } = await supabase
    .from("ride_requests")
    .select("seats_available")
    .eq("id", rideId)
    .single();

  if (rideError) {
    console.error("Error getting ride details:", rideError);
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
    console.error("Error updating ride after join:", updateError);
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
    console.error("Error fetching notifications:", error);
    throw error;
  }

  return data;
};

export const createNotification = async (
  userId: string,
  message: string,
  type: string,
  rideId?: string
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
    console.error("Error creating notification:", error);
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
      }).catch((err) =>
        console.error("Error showing browser notification:", err)
      );
    } else {
      console.log("Browser notifications not supported on this device");
    }
  }

  return data;
};

export const markNotificationAsRead = async (
  notificationId: string,
  userId: string
) => {
  const { error } = await supabase
    .from("notifications")
    .update({ read: true })
    .eq("id", notificationId)
    .eq("user_id", userId);

  if (error) {
    console.error("Error marking notification as read:", error);
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
    console.error("Error marking all notifications as read:", error);
    throw error;
  }
};

export const updateRideStatus = async (
  rideId: string,
  status: RideStatus,
  preserveFields = true
) => {
  try {
    console.log(`Updating ride ${rideId} status to ${status}`);

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
          console.error("Error fetching ride for status update:", error);
          // Continue with minimal data instead of throwing
          console.log("Will proceed with minimal data for update");
        } else if (data) {
          existingData = data;

          // Protection: Don't allow completed or cancelled rides to change back to open
          if (
            (data.status === "completed" || data.status === "cancelled") &&
            (status === "open" || status === "full")
          ) {
            console.warn(
              `Prevented changing ride ${rideId} from ${data.status} to ${status}`
            );
            return data; // Return existing data without making changes
          }
        }
      } catch (fetchError) {
        console.error("Failed to fetch ride data:", fetchError);
        // Continue with minimal data instead of throwing
        console.log("Will proceed with minimal data for update");
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
      console.error(
        `Error updating ride ${rideId} status to ${status}:`,
        error
      );
      throw error;
    }

    console.log(`Successfully updated ride ${rideId} status to ${status}`);
    return data?.[0] || updateData;
  } catch (error) {
    console.error(`Failed to update ride ${rideId} status:`, error);
    throw error;
  }
};
