import type { SupabaseClient } from "@supabase/supabase-js";
import type { Location, RideRequest, RideStatus, VehicleType } from "@/types";

function mapRide(
  ride: {
    id: string;
    creator_id: string;
    starting_point: Location;
    destination: Location;
    seats_available: number;
    total_seats: number;
    status: string;
    created_at: string;
    vehicle: string;
    contact_phone?: string;
  },
  passengers: string[],
): RideRequest {
  return {
    id: ride.id,
    creator: ride.creator_id,
    startingPoint: ride.starting_point,
    destination: ride.destination,
    seatsAvailable: ride.seats_available,
    totalSeats: ride.total_seats,
    passengers,
    status: ride.status as RideStatus,
    createdAt: ride.created_at,
    vehicle: ride.vehicle as VehicleType,
    contactPhone: ride.contact_phone,
  };
}

// Shared select: ride fields + embedded passengers (single round-trip per query)
const RIDE_FIELDS =
  "id, creator_id, starting_point, destination, seats_available, total_seats, status, created_at, vehicle, contact_phone, ride_passengers(user_id)";

function passengersFrom(ride: { ride_passengers?: { user_id: string }[] }): string[] {
  return ride.ride_passengers?.map((p) => p.user_id) ?? [];
}

export async function fetchUserRidesServer(
  supabase: SupabaseClient,
  userId: string,
): Promise<RideRequest[]> {
  const { data: createdRides, error: createdError } = await supabase
    .from("ride_requests")
    .select(RIDE_FIELDS)
    .eq("creator_id", userId);

  if (createdError) throw createdError;

  const { data: joinedRideIds, error: joinedError } = await supabase
    .from("ride_passengers")
    .select("ride_id")
    .eq("user_id", userId);

  if (joinedError) throw joinedError;

  const joinedIds = joinedRideIds?.map((r) => r.ride_id) ?? [];
  let joinedRides: typeof createdRides = [];

  if (joinedIds.length > 0) {
    const { data, error } = await supabase
      .from("ride_requests")
      .select(RIDE_FIELDS)
      .in("id", joinedIds);

    if (error) throw error;
    joinedRides = data ?? [];
  }

  const allRides = [...(createdRides ?? []), ...joinedRides].filter(
    (ride, index, self) => self.findIndex((r) => r.id === ride.id) === index,
  );

  // Passengers embedded — no separate batch query needed
  return allRides.map((ride) => mapRide(ride, passengersFrom(ride)));
}

export async function searchRidesByRouteServer(
  supabase: SupabaseClient,
  startLat: number,
  startLng: number,
  destLat: number,
  destLng: number,
  radiusKm = 1,
  vehicleType?: VehicleType | null,
): Promise<RideRequest[]> {
  // DB-level bounding-box geo filter + passenger join in one query.
  // Requires: SUPABASE_PERFORMANCE_OPTIMIZATIONS.sql → search_rides_by_route RPC.
  const { data, error } = await supabase.rpc("search_rides_by_route", {
    p_start_lat: startLat,
    p_start_lng: startLng,
    p_dest_lat: destLat,
    p_dest_lng: destLng,
    p_radius_degrees: radiusKm / 111,
    p_vehicle_type: vehicleType ?? null,
  });

  if (error) throw error;

  return (data ?? []).map(
    (row: {
      id: string;
      creator_id: string;
      starting_point: Location;
      destination: Location;
      seats_available: number;
      total_seats: number;
      status: string;
      created_at: string;
      vehicle: string;
      contact_phone?: string;
      passenger_ids: string[];
    }) => mapRide(row, row.passenger_ids ?? []),
  );
}

export async function fetchRideByIdServer(
  supabase: SupabaseClient,
  rideId: string,
  userId: string | null,
): Promise<RideRequest | null> {
  // Single query: ride + embedded passengers
  const { data: ride, error } = await supabase
    .from("ride_requests")
    .select(RIDE_FIELDS)
    .eq("id", rideId)
    .single();

  if (error || !ride) return null;

  const passengerIds = passengersFrom(ride);
  const isParticipant =
    !!userId &&
    (ride.creator_id === userId || passengerIds.includes(userId));

  if (!isParticipant && ride.status === "open") {
    return {
      ...mapRide(ride, passengerIds),
      contactPhone: undefined,
    };
  }

  if (!isParticipant) {
    return null;
  }

  return mapRide(ride, passengerIds);
}
