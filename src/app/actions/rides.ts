"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getOptionalUser, requireUser } from "@/lib/auth/require-user";
import {
  createRideSchema,
  joinRideSchema,
  rideIdSchema,
  searchRidesSchema,
  type ActionResult,
} from "@/lib/validation/schemas";
import {
  fetchUserRidesServer,
  searchRidesByRouteServer,
  fetchRideByIdServer,
} from "@/lib/data/rides";
import type { RideRequest, VehicleType } from "@/types";

export async function getUserRidesAction(): Promise<ActionResult<RideRequest[]>> {
  try {
    const user = await requireUser();
    const supabase = await createClient();
    const rides = await fetchUserRidesServer(supabase, user.id);
    return { success: true, data: rides };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}

export async function searchRidesAction(input: {
  startLat: number;
  startLng: number;
  destLat: number;
  destLng: number;
  radiusKm?: number;
  vehicle?: VehicleType | null;
}): Promise<ActionResult<RideRequest[]>> {
  try {
    await requireUser();
    const parsed = searchRidesSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: "Invalid search parameters" };
    }

    const supabase = await createClient();
    const rides = await searchRidesByRouteServer(
      supabase,
      parsed.data.startLat,
      parsed.data.startLng,
      parsed.data.destLat,
      parsed.data.destLng,
      parsed.data.radiusKm,
      parsed.data.vehicle ?? null,
    );

    return { success: true, data: rides };
  } catch {
    return { success: false, error: "Failed to search rides" };
  }
}

export async function getRideByIdAction(
  rideId: string,
): Promise<ActionResult<RideRequest>> {
  try {
    const user = await getOptionalUser();
    const parsed = rideIdSchema.safeParse({ rideId });
    if (!parsed.success) {
      return { success: false, error: "Invalid ride" };
    }

    const supabase = await createClient();
    const ride = await fetchRideByIdServer(
      supabase,
      parsed.data.rideId,
      user?.id ?? null,
    );

    if (!ride) {
      return { success: false, error: "Ride not found or access denied" };
    }

    return { success: true, data: ride };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}

/**
 * Returns the ride creator's phone only when the caller is an active passenger.
 * Phone is decrypted server-side via the get_ride_creator_phone RPC; the
 * encrypted column is never selected directly.
 */
export async function getCreatorPhoneAction(
  rideId: string,
): Promise<ActionResult<{ phone: string }>> {
  try {
    await requireUser();
    const parsed = rideIdSchema.safeParse({ rideId });
    if (!parsed.success) {
      return { success: false, error: "Invalid ride" };
    }

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("get_ride_creator_phone", {
      p_ride_id: parsed.data.rideId,
    });

    if (error) {
      return { success: false, error: "Access denied" };
    }

    if (!data) {
      return { success: false, error: "Creator phone not available" };
    }

    return { success: true, data: { phone: data as string } };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}

export async function createRideAction(
  input: unknown,
): Promise<ActionResult<{ rideId: string }>> {
  try {
    const user = await requireUser();
    if (!user.email_confirmed_at) {
      return {
        success: false,
        error: "Please verify your email before creating a ride",
      };
    }
    const parsed = createRideSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: "Invalid ride data" };
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("ride_requests")
      .insert({
        creator_id: user.id,
        starting_point: parsed.data.startingPoint,
        destination: parsed.data.destination,
        seats_available: parsed.data.totalSeats - 1,
        total_seats: parsed.data.totalSeats,
        vehicle: parsed.data.vehicle,
        status: "open",
        contact_phone: parsed.data.contactPhone,
      })
      .select("id")
      .single();

    if (error || !data) {
      return { success: false, error: "Failed to create ride" };
    }

    const { error: passengerError } = await supabase
      .from("ride_passengers")
      .insert({
        ride_id: data.id,
        user_id: user.id,
        contact_phone: parsed.data.contactPhone,
      });

    if (passengerError) {
      return { success: false, error: "Failed to register as passenger" };
    }

    revalidatePath("/dashboard");
    revalidatePath("/rides");
    return { success: true, data: { rideId: data.id } };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}

export async function joinRideAction(
  input: unknown,
): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = joinRideSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: "Invalid join request" };
    }

    const supabase = await createClient();
    const { data: ride, error: rideError } = await supabase
      .from("ride_requests")
      .select("id, creator_id, seats_available, status")
      .eq("id", parsed.data.rideId)
      .single();

    if (rideError || !ride) {
      return { success: false, error: "Ride not found" };
    }

    if (ride.status !== "open") {
      return { success: false, error: "This ride is no longer available" };
    }

    if (ride.creator_id === user.id) {
      return { success: false, error: "You cannot join your own ride" };
    }

    if (ride.seats_available <= 0) {
      return { success: false, error: "No seats available" };
    }

    const { error: passengerError } = await supabase
      .from("ride_passengers")
      .insert({
        ride_id: parsed.data.rideId,
        user_id: user.id,
        contact_phone: parsed.data.contactPhone,
      });

    if (passengerError) {
      return { success: false, error: "Failed to join ride" };
    }

    const newSeatsAvailable = ride.seats_available - 1;
    const newStatus = newSeatsAvailable <= 0 ? "full" : "open";

    await supabase
      .from("ride_requests")
      .update({
        seats_available: newSeatsAvailable,
        status: newStatus,
      })
      .eq("id", parsed.data.rideId);

    revalidatePath("/dashboard");
    revalidatePath(`/rides/${parsed.data.rideId}`);
    revalidatePath("/rides");
    return { success: true };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}

export async function cancelRideAction(rideId: string): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = rideIdSchema.safeParse({ rideId });
    if (!parsed.success) {
      return { success: false, error: "Invalid ride" };
    }

    const supabase = await createClient();
    const { data: ride } = await supabase
      .from("ride_requests")
      .select("id, creator_id, status")
      .eq("id", parsed.data.rideId)
      .single();

    if (!ride) {
      return { success: false, error: "Ride not found" };
    }

    const { data: membership } = await supabase
      .from("ride_passengers")
      .select("user_id")
      .eq("ride_id", parsed.data.rideId)
      .eq("user_id", user.id)
      .maybeSingle();

    const isCreator = ride.creator_id === user.id;
    const isPassenger = !!membership;

    if (!isCreator && !isPassenger) {
      return { success: false, error: "You are not part of this ride" };
    }

    if (isCreator) {
      if (ride.status === "completed" || ride.status === "cancelled") {
        return { success: false, error: "Ride cannot be modified" };
      }
      await supabase
        .from("ride_requests")
        .update({ status: "cancelled" })
        .eq("id", parsed.data.rideId)
        .eq("creator_id", user.id);
    } else {
      if (ride.status === "completed" || ride.status === "cancelled") {
        return { success: false, error: "Cannot leave this ride" };
      }

      await supabase
        .from("ride_passengers")
        .delete()
        .eq("ride_id", parsed.data.rideId)
        .eq("user_id", user.id);

      const { data: current } = await supabase
        .from("ride_requests")
        .select("seats_available")
        .eq("id", parsed.data.rideId)
        .single();

      if (current) {
        await supabase
          .from("ride_requests")
          .update({
            seats_available: current.seats_available + 1,
            status: "open",
          })
          .eq("id", parsed.data.rideId);
      }
    }

    revalidatePath("/dashboard");
    revalidatePath(`/rides/${parsed.data.rideId}`);
    return { success: true };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}

export async function completeRideAction(rideId: string): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = rideIdSchema.safeParse({ rideId });
    if (!parsed.success) {
      return { success: false, error: "Invalid ride" };
    }

    const supabase = await createClient();
    const { error } = await supabase
      .from("ride_requests")
      .update({ status: "completed" })
      .eq("id", parsed.data.rideId)
      .eq("creator_id", user.id);

    if (error) {
      return { success: false, error: "Failed to complete ride" };
    }

    revalidatePath("/dashboard");
    revalidatePath(`/rides/${parsed.data.rideId}`);
    return { success: true };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}
