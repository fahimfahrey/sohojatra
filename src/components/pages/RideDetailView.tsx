"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import RideDetail from "@/components/rides/RideDetail";
import { getRideByIdAction } from "@/app/actions/rides";
import { useRide } from "@/contexts/RideContext";
import { useAbly } from "@/contexts/AblyContext";
import type { RideRequest } from "@/types";

export default function RideDetailView({ rideId }: { rideId: string }) {
  const { rides } = useRide();
  const { subscribeToEvent } = useAbly();
  const [ride, setRide] = useState<RideRequest | null>(
    rides.find((r) => r.id === rideId) ?? null,
  );
  const [loading, setLoading] = useState(!ride);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await getRideByIdAction(rideId);
      if (!cancelled && result.success && result.data) {
        setRide(result.data);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [rideId]);

  useEffect(() => {
    const local = rides.find((r) => r.id === rideId);
    if (local) setRide(local);
  }, [rides, rideId]);

  useEffect(() => {
    return subscribeToEvent("rides", "sync", () => {
      getRideByIdAction(rideId).then((result) => {
        if (result.success && result.data) setRide(result.data);
      });
    });
  }, [rideId, subscribeToEvent]);

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <main className="flex-grow flex items-center justify-center">
          <div className="animate-spin h-12 w-12 border-t-4 border-accent-500 rounded-full" />
        </main>
        <Footer />
      </div>
    );
  }

  if (!ride) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <main className="flex-grow flex items-center justify-center px-4">
          <div className="bg-white rounded-3xl shadow-large p-8 text-center max-w-md">
            <h2 className="text-2xl font-bold mb-2">Ride Not Found</h2>
            <p className="text-gray-600 mb-6">
              This ride does not exist or you do not have access.
            </p>
            <Link
              href="/rides"
              className="inline-block px-6 py-3 bg-accent-500 text-white rounded-xl font-semibold"
            >
              Find Other Rides
            </Link>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-grow py-6 sm:py-8 bg-gradient-to-br from-accent-50 to-secondary-50">
        <div className="container mx-auto px-4 sm:px-6">
          <RideDetail ride={ride} />
        </div>
      </main>
      <Footer />
    </div>
  );
}
