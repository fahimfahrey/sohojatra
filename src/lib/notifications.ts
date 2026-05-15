import { supabase } from "./supabase";
import { fetchRidePassengersWithDetails } from "./database";

/**
 * Sends a notification to all passengers of a ride
 * @param rideId The ID of the ride
 * @param message The notification message
 * @param type The type of notification
 */
export const notifyAllRidePassengers = async (
  rideId: string,
  message: string,
  type: "update" | "join" | "leave" | "system" | "match",
) => {
  try {
    // Get all passengers of the ride
    const passengers = await fetchRidePassengersWithDetails(rideId);

    if (passengers.length === 0) {
      return 0;
    }

    // Create a notification for each passenger
    const notifications = passengers.map((passenger) => ({
      user_id: passenger.user_id,
      message,
      type,
      read: false,
      ride_id: rideId,
    }));

    // Insert all notifications at once
    if (notifications.length > 0) {
      const { error } = await supabase
        .from("notifications")
        .insert(notifications);

      if (error) {
        throw error;
      }

      return notifications.length;
    }

    return 0;
  } catch (error) {
    // Try sending notifications one by one as a fallback
    try {
      const passengers = await fetchRidePassengersWithDetails(rideId);

      let successCount = 0;
      for (const passenger of passengers) {
        try {
          const { error } = await supabase.from("notifications").insert({
            user_id: passenger.user_id,
            message,
            type,
            read: false,
            ride_id: rideId,
          });

          if (!error) {
            successCount++;
          }
        } catch (innerError) {
          // Failed to notify passenger
        }
      }

      return successCount;
    } catch (fallbackError) {
      throw error; // Throw the original error
    }
  }
};
