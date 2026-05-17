"use client";

import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import FindRideForm from "@/components/rides/FindRideForm";

export default function FindRidesView() {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-grow py-6 sm:py-8 bg-gradient-to-br from-accent-50 to-secondary-50">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-6 sm:mb-8">
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2">
              Find Your Perfect Ride
            </h1>
            <p className="text-gray-600 max-w-2xl mx-auto">
              Discover rides going your way and connect with fellow travelers.
            </p>
          </div>
          <FindRideForm />
        </div>
      </main>
      <Footer />
    </div>
  );
}
