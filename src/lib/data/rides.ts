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

export async function fetchUserRidesServer(
  supabase: SupabaseClient,
  userId: string,
): Promise<RideRequest[]> {
  const { data: createdRides, error: createdError } = await supabase
    .from("ride_requests")
    .select(
      "id, creator_id, starting_point, destination, seats_available, total_seats, status, created_at, vehicle, contact_phone",
    )
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
      .select(
        "id, creator_id, starting_point, destination, seats_available, total_seats, status, created_at, vehicle, contact_phone",
      )
      .in("id", joinedIds);

    if (error) throw error;
    joinedRides = data ?? [];
  }

  const allRides = [...(createdRides ?? []), ...joinedRides].filter(
    (ride, index, self) => self.findIndex((r) => r.id === ride.id) === index,
  );

  const allRideIds = allRides.map((r) => r.id);
  const { data: allPassengers } = await supabase
    .from("ride_passengers")
    .select("ride_id, user_id")
    .in("ride_id", allRideIds);

  const passengersByRide = new Map<string, string[]>();
  (allPassengers ?? []).forEach((p) => {
    const list = passengersByRide.get(p.ride_id) ?? [];
    list.push(p.user_id);
    passengersByRide.set(p.ride_id, list);
  });

  return allRides.map((ride) =>
    mapRide(ride, passengersByRide.get(ride.id) ?? []),
  );
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
  const radiusDegrees = radiusKm / 111;

  let query = supabase
    .from("ride_requests")
    .select(
      "id, creator_id, starting_point, destination, seats_available, total_seats, status, created_at, vehicle, contact_phone",
    )
    .eq("status", "open");

  if (vehicleType) {
    query = query.eq("vehicle", vehicleType);
  }

  const { data, error } = await query;
  if (error) throw error;

  const matchingRides = (data ?? []).filter((ride) => {
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

  const ridesWithPassengers = await Promise.all(
    matchingRides.map(async (ride) => {
      const { data: passengers } = await supabase
        .from("ride_passengers")
        .select("user_id")
        .eq("ride_id", ride.id);

      return mapRide(
        ride,
        passengers?.map((p) => p.user_id) ?? [],
      );
    }),
  );

  return ridesWithPassengers;
}

export async function fetchRideByIdServer(
  supabase: SupabaseClient,
  rideId: string,
  userId: string | null,
): Promise<RideRequest | null> {
  const { data: ride, error } = await supabase
    .from("ride_requests")
    .select(
      "id, creator_id, starting_point, destination, seats_available, total_seats, status, created_at, vehicle, contact_phone",
    )
    .eq("id", rideId)
    .single();

  if (error || !ride) return null;

  const { data: passengers } = await supabase
    .from("ride_passengers")
    .select("user_id")
    .eq("ride_id", rideId);

  const passengerIds = passengers?.map((p) => p.user_id) ?? [];
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
