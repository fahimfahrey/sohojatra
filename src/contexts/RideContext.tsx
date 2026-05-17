"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import type { RideRequest, Location, VehicleType } from "@/types";
import { useAuth } from "./AuthContext";
import { useAbly } from "./AblyContext";
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

export function RideProvider({ children }: { children: React.ReactNode }) {
  const [rides, setRides] = useState<RideRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();
  const { publishEvent, subscribeToEvent } = useAbly();

  const refreshUserRides = useCallback(async () => {
    if (!user) {
      setRides([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const result = await getUserRidesAction();
    if (result.success && result.data) {
      setRides(result.data);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    refreshUserRides();
  }, [refreshUserRides]);

  useEffect(() => {
    if (!user) return;
    const unsub = subscribeToEvent("rides", "sync", () => {
      refreshUserRides();
    });
    return unsub;
  }, [user, subscribeToEvent, refreshUserRides]);

  const createRideRequest = async (
    startingPoint: Location,
    destination: Location,
    totalSeats: number,
    contactPhone: string,
    vehicle: VehicleType,
  ): Promise<RideRequest> => {
    const result = await createRideAction({
      startingPoint,
      destination,
      totalSeats,
      contactPhone,
      vehicle,
    });

    if (!result.success || !result.data) {
      throw new Error(
        !result.success ? result.error : "Failed to create ride",
      );
    }

    await refreshUserRides();
    const created = rides.find((r) => r.id === result.data!.rideId);
    if (created) {
      publishEvent("rides", "sync", { rideId: created.id, action: "create" });
      return created;
    }

    const refreshed = await getUserRidesAction();
    const ride =
      refreshed.success && refreshed.data
        ? refreshed.data.find((r) => r.id === result.data!.rideId)
        : undefined;
    if (!ride) throw new Error("Ride created but not found");
    publishEvent("rides", "sync", { rideId: ride.id, action: "create" });
    return ride;
  };

  const joinRideRequest = async (rideId: string, contactPhone: string) => {
    const result = await joinRideAction({ rideId, contactPhone });
    if (!result.success) throw new Error(result.error);
    await refreshUserRides();
    publishEvent("rides", "sync", { rideId, action: "join" });
  };

  const cancelRideRequest = async (rideId: string) => {
    const result = await cancelRideAction(rideId);
    if (!result.success) throw new Error(result.error);
    await refreshUserRides();
    publishEvent("rides", "sync", { rideId, action: "cancel" });
  };

  const completeRideRequest = async (rideId: string) => {
    const result = await completeRideAction(rideId);
    if (!result.success) throw new Error(result.error);
    await refreshUserRides();
    publishEvent("rides", "sync", { rideId, action: "complete" });
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
