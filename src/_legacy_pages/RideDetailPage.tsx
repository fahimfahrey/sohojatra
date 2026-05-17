import React, { useState, useEffect } from "react";
import { useParams, Navigate } from "react-router-dom";
import Header from "../components/layout/Header";
import Footer from "../components/layout/Footer";
import RideDetail from "../components/rides/RideDetail";
import { useRide } from "../contexts/RideContext";
import { useAuth } from "../contexts/AuthContext";
import { useAbly } from "../contexts/AblyContext";
import { RideRequest } from "../types";

const RideDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { rides } = useRide();
  const { isAuthenticated, isLoading } = useAuth();
  const { subscribeToEvent } = useAbly();
  const [currentRide, setCurrentRide] = useState<RideRequest | undefined>(
    rides.find((r) => r.id === id)
  );

  useEffect(() => {
    // Initialize with the current state from rides context
    setCurrentRide(rides.find((r) => r.id === id));
  }, [rides, id]);

  // Subscribe to real-time updates for this specific ride
  useEffect(() => {
    if (!id) return;

    const handleRideUpdate = (message: { data: Record<string, unknown> }) => {
      const updatedRide = message.data as RideRequest;
      if (updatedRide.id === id) {
        setCurrentRide(updatedRide);
      }
    };

    // Subscribe to all ride events that might update this ride
    const unsubscribeUpdate = subscribeToEvent(
      "rides",
      "update",
      handleRideUpdate
    );
    const unsubscribeJoin = subscribeToEvent("rides", "join", handleRideUpdate);
    const unsubscribeLeave = subscribeToEvent(
      "rides",
      "leave",
      handleRideUpdate
    );
    const unsubscribeNew = subscribeToEvent("rides", "new", handleRideUpdate);

    return () => {
      unsubscribeUpdate();
      unsubscribeJoin();
      unsubscribeLeave();
      unsubscribeNew();
    };
  }, [id, subscribeToEvent]);

  // If loading, show loading state
  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <main className="flex-grow flex items-center justify-center bg-gradient-to-br from-accent-50 to-secondary-50">
          <div className="text-center">
            <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-accent-500 mx-auto"></div>
            <p className="mt-6 text-gray-600 text-lg">Loading ride details...</p>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  // If not authenticated, redirect to login
  if (!isAuthenticated) {
    return <Navigate to="/login" />;
  }

  // If ride not found
  if (!currentRide) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <main className="flex-grow flex items-center justify-center bg-gradient-to-br from-accent-50 to-secondary-50">
          <div className="text-center bg-white rounded-3xl shadow-large p-12 max-w-md mx-4">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.172 16.172a4 4 0 015.656 0M9 12h6m-6-4h6m2 5.291A7.962 7.962 0 0112 15c-2.034 0-3.9.785-5.291 2.09M6.343 6.343A8 8 0 1017.657 17.657 8 8 0 006.343 6.343z" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              Ride Not Found
            </h2>
            <p className="text-gray-600 mb-8">
              The ride you're looking for doesn't exist or has been removed.
            </p>
            <a
              href="/rides"
              className="btn-modern px-8 py-3 bg-gradient-to-r from-accent-400 to-accent-500 hover:from-accent-500 hover:to-accent-600 text-white rounded-2xl font-semibold transition-all duration-300 transform hover:scale-105 shadow-medium"
            >
              Find Other Rides
            </a>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <main className="flex-grow py-6 sm:py-8 lg:py-12 bg-gradient-to-br from-accent-50 to-secondary-50">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <RideDetail ride={currentRide} />
        </div>
      </main>

      <Footer />
    </div>
  );
};

export default RideDetailPage;
