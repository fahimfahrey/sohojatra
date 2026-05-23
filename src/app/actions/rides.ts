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
import { validateCsrfToken } from "@/lib/security/csrf";
import { checkRateLimit } from "@/lib/rate-limit/server";
import { logAuditEvent, diffChanges } from "@/lib/audit";
import { requireFreshTotp } from "@/lib/auth/require-fresh-totp";
import { captureError } from "@/lib/observability/sentry";
import type { RideRequest, VehicleType } from "@/types";

const CSRF_ERROR: ActionResult<never> = {
  success: false,
  error: "Invalid or missing CSRF token",
};

const STEPUP_ERROR: ActionResult<never> = {
  success: false,
  error: "2FA verification required",
  code: "2FA_STEPUP_REQUIRED",
};

export async function getUserRidesAction(): Promise<ActionResult<RideRequest[]>> {
  try {
    const user = await requireUser();
    const supabase = await createClient();
    const rides = await fetchUserRidesServer(supabase, user.id);
    return { success: true, data: rides };
  } catch (err) {
    captureError(err, { action: "ride.list" });
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
    const user = await requireUser();
    if (!(await checkRateLimit(`search:${user.id}`, 30, 60 * 1000))) {
      return { success: false, error: "Too many searches. Please slow down." };
    }
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
  } catch (err) {
    captureError(err, { action: "ride.search" });
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
      await logAuditEvent({
        action: "data.read",
        outcome: "failure",
        userId: user?.id ?? null,
        resourceId: parsed.data.rideId,
        detail: { resource_type: "ride", reason: "not_found_or_forbidden" },
      });
      return { success: false, error: "Ride not found or access denied" };
    }

    await logAuditEvent({
      action: "data.read",
      outcome: "success",
      userId: user?.id ?? null,
      resourceId: parsed.data.rideId,
      detail: { resource_type: "ride" },
    });

    return { success: true, data: ride };
  } catch (err) {
    captureError(err, { action: "ride.get", rideId });
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
    const user = await requireUser();
    const parsed = rideIdSchema.safeParse({ rideId });
    if (!parsed.success) {
      await logAuditEvent({
        action: "phone.access",
        outcome: "failure",
        userId: user.id,
        detail: { reason: "invalid_ride_id" },
      });
      return { success: false, error: "Invalid ride" };
    }

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("get_ride_creator_phone", {
      p_ride_id: parsed.data.rideId,
    });

    if (error) {
      await logAuditEvent({
        action: "phone.access",
        outcome: "failure",
        userId: user.id,
        resourceId: parsed.data.rideId,
        detail: { reason: "rpc_error", code: error.code ?? null },
      });
      captureError(error, {
        action: "phone.access",
        userId: user.id,
        rideId: parsed.data.rideId,
        severity: "critical",
        reason: "rpc_error",
      });
      return { success: false, error: "Access denied" };
    }

    if (!data) {
      await logAuditEvent({
        action: "phone.access",
        outcome: "failure",
        userId: user.id,
        resourceId: parsed.data.rideId,
        detail: { reason: "no_phone" },
      });
      return { success: false, error: "Creator phone not available" };
    }

    await logAuditEvent({
      action: "phone.access",
      outcome: "success",
      userId: user.id,
      resourceId: parsed.data.rideId,
    });

    return { success: true, data: { phone: data as string } };
  } catch (err) {
    captureError(err, { action: "phone.access", rideId });
    return { success: false, error: "Unauthorized" };
  }
}

export async function createRideAction(
  input: unknown,
  csrfToken: string,
): Promise<ActionResult<{ rideId: string }>> {
  try {
    if (!(await validateCsrfToken(csrfToken))) return CSRF_ERROR;
    const user = await requireUser();
    if (!user.email_confirmed_at) {
      return {
        success: false,
        error: "Please verify your email before creating a ride",
      };
    }
    const stepup = await requireFreshTotp(user);
    if (!stepup.ok) return STEPUP_ERROR;
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
      await logAuditEvent({
        action: "ride.create",
        outcome: "failure",
        userId: user.id,
        detail: { reason: "db_error" },
      });
      captureError(error ?? new Error("ride insert returned no row"), {
        action: "ride.create",
        userId: user.id,
        severity: "critical",
        reason: "db_error",
      });
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
      await logAuditEvent({
        action: "ride.create",
        outcome: "failure",
        userId: user.id,
        resourceId: data.id,
        detail: { reason: "passenger_insert_failed" },
      });
      captureError(passengerError, {
        action: "ride.create",
        userId: user.id,
        rideId: data.id,
        severity: "critical",
        reason: "passenger_insert_failed",
      });
      return { success: false, error: "Failed to register as passenger" };
    }

    await logAuditEvent({
      action: "ride.create",
      outcome: "success",
      userId: user.id,
      resourceId: data.id,
      detail: {
        vehicle: parsed.data.vehicle,
        total_seats: parsed.data.totalSeats,
      },
      changes: {
        before: null,
        after: {
          status: "open",
          seats_available: parsed.data.totalSeats - 1,
          total_seats: parsed.data.totalSeats,
          vehicle: parsed.data.vehicle,
        },
      },
    });

    revalidatePath("/dashboard");
    revalidatePath("/rides");
    return { success: true, data: { rideId: data.id } };
  } catch (err) {
    captureError(err, { action: "ride.create" });
    return { success: false, error: "Unauthorized" };
  }
}

export async function joinRideAction(
  input: unknown,
  csrfToken: string,
): Promise<ActionResult> {
  try {
    if (!(await validateCsrfToken(csrfToken))) return CSRF_ERROR;
    const user = await requireUser();
    if (!(await checkRateLimit(`join:${user.id}`, 10, 60 * 1000))) {
      return { success: false, error: "Too many join attempts. Please slow down." };
    }
    const stepup = await requireFreshTotp(user);
    if (!stepup.ok) return STEPUP_ERROR;
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
      await logAuditEvent({
        action: "ride.join",
        outcome: "failure",
        userId: user.id,
        resourceId: parsed.data.rideId,
        detail: { reason: "passenger_insert_failed" },
      });
      captureError(passengerError, {
        action: "ride.join",
        userId: user.id,
        rideId: parsed.data.rideId,
        severity: "critical",
        reason: "passenger_insert_failed",
      });
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

    await logAuditEvent({
      action: "ride.join",
      outcome: "success",
      userId: user.id,
      resourceId: parsed.data.rideId,
      detail: { creator_id: ride.creator_id },
      changes: diffChanges(
        { seats_available: ride.seats_available, status: ride.status },
        { seats_available: newSeatsAvailable, status: newStatus },
        ["seats_available", "status"],
      ),
    });

    revalidatePath("/dashboard");
    revalidatePath(`/rides/${parsed.data.rideId}`);
    revalidatePath("/rides");
    return { success: true };
  } catch (err) {
    captureError(err, { action: "ride.join" });
    return { success: false, error: "Unauthorized" };
  }
}

export async function cancelRideAction(
  rideId: string,
  csrfToken: string,
): Promise<ActionResult> {
  try {
    if (!(await validateCsrfToken(csrfToken))) return CSRF_ERROR;
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
      await logAuditEvent({
        action: "ride.cancel",
        outcome: "success",
        userId: user.id,
        resourceId: parsed.data.rideId,
        detail: { role: "creator" },
        changes: diffChanges(
          { status: ride.status },
          { status: "cancelled" },
          ["status"],
        ),
      });
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

      const beforeSeats = current?.seats_available ?? null;
      const afterSeats =
        beforeSeats !== null ? beforeSeats + 1 : null;

      if (current) {
        await supabase
          .from("ride_requests")
          .update({
            seats_available: afterSeats!,
            status: "open",
          })
          .eq("id", parsed.data.rideId);
      }
      await logAuditEvent({
        action: "ride.cancel",
        outcome: "success",
        userId: user.id,
        resourceId: parsed.data.rideId,
        detail: { role: "passenger" },
        changes: diffChanges(
          { seats_available: beforeSeats, status: ride.status },
          { seats_available: afterSeats, status: "open" },
          ["seats_available", "status"],
        ),
      });
    }

    revalidatePath("/dashboard");
    revalidatePath(`/rides/${parsed.data.rideId}`);
    return { success: true };
  } catch (err) {
    captureError(err, { action: "ride.cancel", rideId });
    return { success: false, error: "Unauthorized" };
  }
}

export async function completeRideAction(
  rideId: string,
  csrfToken: string,
): Promise<ActionResult> {
  try {
    if (!(await validateCsrfToken(csrfToken))) return CSRF_ERROR;
    const user = await requireUser();
    const parsed = rideIdSchema.safeParse({ rideId });
    if (!parsed.success) {
      return { success: false, error: "Invalid ride" };
    }

    const supabase = await createClient();
    const { data: prior } = await supabase
      .from("ride_requests")
      .select("status")
      .eq("id", parsed.data.rideId)
      .eq("creator_id", user.id)
      .maybeSingle();

    const { error } = await supabase
      .from("ride_requests")
      .update({ status: "completed" })
      .eq("id", parsed.data.rideId)
      .eq("creator_id", user.id);

    if (error) {
      await logAuditEvent({
        action: "ride.complete",
        outcome: "failure",
        userId: user.id,
        resourceId: parsed.data.rideId,
        detail: { reason: "db_error" },
      });
      captureError(error, {
        action: "ride.complete",
        userId: user.id,
        rideId: parsed.data.rideId,
        severity: "critical",
        reason: "db_error",
      });
      return { success: false, error: "Failed to complete ride" };
    }

    await logAuditEvent({
      action: "ride.complete",
      outcome: "success",
      userId: user.id,
      resourceId: parsed.data.rideId,
      changes: diffChanges(
        { status: prior?.status ?? null },
        { status: "completed" },
        ["status"],
      ),
    });

    revalidatePath("/dashboard");
    revalidatePath(`/rides/${parsed.data.rideId}`);
    return { success: true };
  } catch (err) {
    captureError(err, { action: "ride.complete", rideId });
    return { success: false, error: "Unauthorized" };
  }
}
