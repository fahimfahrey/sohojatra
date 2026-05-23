"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import type { RideRequest, Location, VehicleType } from "@/types";
import { useAuth } from "./AuthContext";
import { RIDES_CHANNEL, useAbly } from "./AblyContext";
import { useCsrfToken } from "./CsrfContext";
import { getBreaker, readCache, writeCache } from "@/lib/resilient-fetch";
import { CircuitOpenError } from "@/lib/circuit-breaker";
import {
  getUserRidesAction,
  searchRidesAction,
  createRideAction,
  joinRideAction,
  cancelRideAction,
  completeRideAction,
} from "@/app/actions/rides";

interface RideContextType {
  rides: RideRequest[];
  userRides: RideRequest[];
  loading: boolean;
  stale: boolean;
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
  ) => Promise<RideRequest[]>;
  refreshUserRides: () => Promise<void>;
  syncRideStatus: (rideId: string) => Promise<void>;
}

const RideContext = createContext<RideContextType | undefined>(undefined);

const POLL_INTERVAL_MS = 15_000;
const ridesCacheKey = (userId: string) => `coshare.rides.${userId}`;

export function RideProvider({ children }: { children: React.ReactNode }) {
  const [rides, setRides] = useState<RideRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [stale, setStale] = useState(false);
  const { user } = useAuth();
  const { publishEvent, subscribeToEvent, connectionMode } = useAbly();
  const csrfToken = useCsrfToken();

  const refreshUserRides = useCallback(async () => {
    if (!user) {
      setRides([]);
      setStale(false);
      setLoading(false);
      return;
    }

    const breaker = getBreaker("supabase-rides", {
      failureThreshold: 3,
      resetTimeoutMs: 30_000,
    });
    const cacheKey = ridesCacheKey(user.id);

    setLoading(true);
    try {
      const result = await breaker.execute(() => getUserRidesAction());
      if (result.success && result.data) {
        setRides(result.data);
        setStale(false);
        writeCache(cacheKey, result.data);
      } else {
        throw new Error(result.success ? "empty response" : result.error);
      }
    } catch (err) {
      if (!(err instanceof CircuitOpenError)) {
        console.warn("[rides] refresh failed, serving cache", err);
      }
      const cached = readCache<RideRequest[]>(cacheKey);
      if (cached) {
        setRides(cached);
      }
      setStale(true);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    refreshUserRides();
  }, [refreshUserRides]);

  useEffect(() => {
    if (!user) return;
    const unsub = subscribeToEvent(RIDES_CHANNEL, "sync", () => {
      refreshUserRides();
    });
    return unsub;
  }, [user, subscribeToEvent, refreshUserRides]);

  // Polling fallback when Ably is unavailable.
  useEffect(() => {
    if (!user || connectionMode !== "polling") return;
    const id = setInterval(() => {
      refreshUserRides();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [user, connectionMode, refreshUserRides]);

  const createRideRequest = async (
    startingPoint: Location,
    destination: Location,
    totalSeats: number,
    contactPhone: string,
    vehicle: VehicleType,
  ): Promise<RideRequest> => {
    const result = await createRideAction(
      {
        startingPoint,
        destination,
        totalSeats,
        contactPhone,
        vehicle,
      },
      csrfToken,
    );

    if (!result.success || !result.data) {
      throw new Error(
        !result.success ? result.error : "Failed to create ride",
      );
    }

    await refreshUserRides();
    const created = rides.find((r) => r.id === result.data!.rideId);
    if (created) {
      publishEvent(RIDES_CHANNEL, "sync", {
        rideId: created.id,
        action: "create",
      });
      return created;
    }

    const refreshed = await getUserRidesAction();
    const ride =
      refreshed.success && refreshed.data
        ? refreshed.data.find((r) => r.id === result.data!.rideId)
        : undefined;
    if (!ride) throw new Error("Ride created but not found");
    publishEvent(RIDES_CHANNEL, "sync", { rideId: ride.id, action: "create" });
    return ride;
  };

  const joinRideRequest = async (rideId: string, contactPhone: string) => {
    const result = await joinRideAction({ rideId, contactPhone }, csrfToken);
    if (!result.success) throw new Error(result.error);
    await refreshUserRides();
    publishEvent(RIDES_CHANNEL, "sync", { rideId, action: "join" });
  };

  const cancelRideRequest = async (rideId: string) => {
    const result = await cancelRideAction(rideId, csrfToken);
    if (!result.success) throw new Error(result.error);
    await refreshUserRides();
    publishEvent(RIDES_CHANNEL, "sync", { rideId, action: "cancel" });
  };

  const completeRideRequest = async (rideId: string) => {
    const result = await completeRideAction(rideId, csrfToken);
    if (!result.success) throw new Error(result.error);
    await refreshUserRides();
    publishEvent(RIDES_CHANNEL, "sync", { rideId, action: "complete" });
  };

  const findMatchingRides = async (
    startPoint: Location,
    endPoint: Location,
    vehicleFilter?: VehicleType | null,
  ) => {
    const result = await searchRidesAction({
      startLat: startPoint.coordinates.lat,
      startLng: startPoint.coordinates.lng,
      destLat: endPoint.coordinates.lat,
      destLng: endPoint.coordinates.lng,
      vehicle: vehicleFilter,
    });
    return result.success && result.data ? result.data : [];
  };

  return (
    <RideContext.Provider
      value={{
        rides,
        userRides: rides,
        loading,
        stale,
        createRideRequest,
        joinRideRequest,
        cancelRideRequest,
        completeRideRequest,
        findMatchingRides,
        refreshUserRides,
        syncRideStatus: async () => {
          await refreshUserRides();
        },
      }}
    >
      {children}
    </RideContext.Provider>
  );
}

export function useRide() {
  const context = useContext(RideContext);
  if (!context) {
    throw new Error("useRide must be used within RideProvider");
  }
  return context;
}
