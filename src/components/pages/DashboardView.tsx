"use client";

import Link from "next/link";
import { Plus, MapPin, Users, Clock } from "lucide-react";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import RideList from "@/components/rides/RideList";
import { useAuth } from "@/contexts/AuthContext";
import { useRide } from "@/contexts/RideContext";

export default function DashboardView() {
  const { user } = useAuth();
  const { userRides, loading } = useRide();

  const joinedRides = userRides.filter(
    (ride) => user && ride.creator !== user.id && ride.passengers.includes(user.id),
  );
  const createdRides = userRides.filter(
    (ride) => user && ride.creator === user.id,
  );
  const activeRides = userRides.filter(
    (ride) => ride.status === "open" || ride.status === "full",
  );

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

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-accent-50 to-secondary-50">
      <Header />
      <main className="flex-grow py-6 sm:py-8">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
          <div className="bg-white rounded-2xl shadow-large p-6 sm:p-8 border border-gray-100">
            <div className="flex flex-col lg:flex-row justify-between gap-6">
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">
                  Welcome back, {user?.name ?? "User"}!
                </h1>
                <p className="text-gray-600 mt-2">
                  Manage your rides and find new journey companions.
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-3">
                <Link
                  href="/create-ride"
                  className="px-5 py-3 bg-gradient-to-r from-accent-400 to-accent-500 text-white rounded-xl font-semibold flex items-center justify-center gap-2"
                >
                  <Plus className="h-5 w-5" /> Create Ride
                </Link>
                <Link
                  href="/rides"
                  className="px-5 py-3 border-2 border-accent-200 text-accent-600 rounded-xl font-semibold flex items-center justify-center gap-2"
                >
                  <MapPin className="h-5 w-5" /> Find Rides
                </Link>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: "Created", value: createdRides.length, Icon: Users },
              { label: "Joined", value: joinedRides.length, Icon: MapPin },
              { label: "Active", value: activeRides.length, Icon: Clock },
              { label: "Total", value: userRides.length, Icon: Users },
            ].map(({ label, value, Icon }) => (
              <div
                key={label}
                className="bg-white rounded-2xl p-4 shadow-soft border border-gray-100"
              >
                <Icon className="h-6 w-6 text-accent-600 mb-2" />
                <p className="text-xs text-gray-500 uppercase">{label}</p>
                <p className="text-2xl font-bold">{value}</p>
              </div>
            ))}
          </div>

          <section>
            <h2 className="text-xl sm:text-2xl font-bold mb-4">Your Rides</h2>
            <RideList
              rides={createdRides}
              showActions
              emptyMessage="You haven't created any rides yet."
            />
          </section>

          <section>
            <h2 className="text-xl sm:text-2xl font-bold mb-4">Joined Rides</h2>
            <RideList
              rides={joinedRides}
              showActions
              emptyMessage="You haven't joined any rides yet."
            />
          </section>
        </div>
      </main>
      <Footer />
    </div>
  );
}
