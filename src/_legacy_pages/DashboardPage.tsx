import React, { useEffect, useState } from "react";
import Header from "../components/layout/Header";
import Footer from "../components/layout/Footer";
import { useAuth } from "../contexts/AuthContext";
import { useRide } from "../contexts/RideContext";
import { useAbly } from "../contexts/AblyContext";
import { Link, useNavigate } from "react-router-dom";
import { Users, Plus, MapPin, ChevronsRight, TrendingUp, Clock, CheckCircle } from "lucide-react";
import RideList from "../components/rides/RideList";
import { getAuthTokenKey } from "../lib/sessionHelper";
import { RideRequest } from "../types";

const DashboardPage: React.FC = () => {
  const { user, isAuthenticated } = useAuth();
  const { userRides, rides, refreshAllRides, loading } = useRide();
  const { subscribeToEvent } = useAbly();
  const navigate = useNavigate();
  const [tokenUser, setTokenUser] = useState<{
    id: string;
    name: string;
    email: string;
  } | null>(null);
  const [dashboardRides, setDashboardRides] = useState<RideRequest[]>([]);
  const [dashboardUserRides, setDashboardUserRides] = useState<RideRequest[]>(
    []
  );

  // Update local state when the rides context changes
  useEffect(() => {
    console.log(
      "Dashboard updating from context:",
      rides.length,
      "total rides,",
      userRides.length,
      "user rides"
    );
    setDashboardRides(rides);
    setDashboardUserRides(userRides);
  }, [rides, userRides]);

  // Subscribe to real-time updates
  useEffect(() => {
    const activeUser = user || tokenUser;
    if (!activeUser) return;

    const handleRideUpdate = (message: { data: Record<string, unknown> }) => {
      const updatedRide = message.data as RideRequest;
      console.log(
        "Dashboard received ride update:",
        updatedRide.status,
        updatedRide.id
      );

      // Update rides list
      setDashboardRides((prevRides) => {
        // Replace the ride if it exists, otherwise add it
        const exists = prevRides.some((ride) => ride.id === updatedRide.id);
        if (exists) {
          return prevRides.map((ride) =>
            ride.id === updatedRide.id ? updatedRide : ride
          );
        } else {
          return [...prevRides, updatedRide];
        }
      });

      // Check if this is a user ride
      const isUserRide =
        updatedRide.creator === activeUser.id ||
        updatedRide.passengers.includes(activeUser.id);

      if (isUserRide) {
        console.log("Updating user ride in dashboard:", updatedRide.status);
        setDashboardUserRides((prevUserRides) => {
          // Check if ride already exists in user rides
          const rideExists = prevUserRides.some(
            (ride) => ride.id === updatedRide.id
          );

          if (rideExists) {
            // Update existing ride
            return prevUserRides.map((ride) =>
              ride.id === updatedRide.id ? updatedRide : ride
            );
          } else {
            // Add new ride
            return [...prevUserRides, updatedRide];
          }
        });
      }
    };

    const handleNewRide = (message: { data: Record<string, unknown> }) => {
      const newRide = message.data as RideRequest;

      // Add to rides list if it's not already there
      setDashboardRides((prevRides) => {
        if (prevRides.some((ride) => ride.id === newRide.id)) {
          return prevRides;
        }
        return [...prevRides, newRide];
      });

      // Check if this is a user ride
      const isUserRide =
        newRide.creator === activeUser.id ||
        newRide.passengers.includes(activeUser.id);

      if (isUserRide) {
        setDashboardUserRides((prevUserRides) => {
          if (prevUserRides.some((ride) => ride.id === newRide.id)) {
            return prevUserRides;
          }
          return [...prevUserRides, newRide];
        });
      }
    };

    // Subscribe to ride events
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
    const unsubscribeNew = subscribeToEvent("rides", "new", handleNewRide);

    return () => {
      unsubscribeUpdate();
      unsubscribeJoin();
      unsubscribeLeave();
      unsubscribeNew();
    };
  }, [user, tokenUser, subscribeToEvent]);

  // Check for token directly
  useEffect(() => {
    if (!isAuthenticated) {
      // Check localStorage for token
      const tokenKey = getAuthTokenKey();
      const token = localStorage.getItem(tokenKey);

      if (token) {
        try {
          const tokenData = JSON.parse(token);
          if (tokenData.user && tokenData.user.id) {
            // Create user from token data
            const user = {
              id: tokenData.user.id,
              name:
                tokenData.user.user_metadata?.name ||
                tokenData.user.user_metadata?.full_name ||
                tokenData.user.email?.split("@")[0] ||
                "User",
              email: tokenData.user.email || "",
            };
            setTokenUser(user);
          }
        } catch (error) {
          console.error("Error parsing token:", error);
          navigate("/login");
        }
      } else {
        // No token, redirect to login
        navigate("/login");
      }
    }
  }, [isAuthenticated, navigate]);

  // Calculate stats
  const activeRides = dashboardUserRides.filter(
    (ride) => ride.status === "open" || ride.status === "full"
  );
  const completedRides = dashboardUserRides.filter(
    (ride) => ride.status === "completed"
  );
  const pastRides = dashboardUserRides.filter(
    (ride) => ride.status === "completed" || ride.status === "cancelled"
  );
  const availableRides = dashboardRides.filter(
    (ride) => ride.status === "open" && ride.seatsAvailable > 0
  ).length;

  const displayUser = user || tokenUser;

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <main className="flex-grow flex items-center justify-center bg-gradient-to-br from-accent-50 to-secondary-50">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 sm:h-16 sm:w-16 border-t-4 border-b-4 border-accent-500 mx-auto"></div>
            <p className="mt-4 sm:mt-6 text-gray-600 text-base sm:text-lg">Loading...</p>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-accent-50 to-secondary-50">
      <Header />

      <main className="flex-grow py-6 sm:py-8">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          {/* Welcome Section */}
          <div className="mb-8 sm:mb-12">
            <div className="bg-white rounded-2xl sm:rounded-3xl shadow-large p-6 sm:p-8 border border-gray-100">
              <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6">
                <div>
                  <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-gray-900 mb-2">
                    Welcome back, {displayUser?.name || "User"}!
                  </h1>
                  <p className="text-lg sm:text-xl text-gray-600">
                    Manage your rides and discover new journey companions
                  </p>
                </div>
                <div className="flex flex-col sm:flex-row gap-3 w-full lg:w-auto">
                  <Link
                    to="/create-ride"
                    onClick={() => {
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                    className="btn-modern px-4 sm:px-6 py-3 bg-gradient-to-r from-accent-400 to-accent-500 hover:from-accent-500 hover:to-accent-600 text-white rounded-2xl font-semibold transition-all duration-300 transform hover:scale-105 shadow-medium hover:shadow-large flex items-center justify-center gap-2"
                  >
                    <Plus className="h-4 w-4 sm:h-5 sm:w-5" />
                    Create Ride
                  </Link>
                  <Link
                    to="/rides"
                    className="px-4 sm:px-6 py-3 bg-white text-accent-600 border-2 border-accent-200 hover:border-accent-400 rounded-2xl font-semibold transition-all duration-300 hover:bg-accent-50 flex items-center justify-center gap-2"
                  >
                    <MapPin className="h-4 w-4 sm:h-5 sm:w-5" />
                    Find Rides
                  </Link>
                </div>
              </div>
            </div>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 mb-8 sm:mb-12">
            <div className="bg-white rounded-2xl p-4 sm:p-6 shadow-soft hover:shadow-medium transition-all duration-300 border border-gray-100">
              <div className="flex items-center">
                <div className="w-10 h-10 sm:w-12 sm:h-12 bg-gradient-to-br from-accent-200 to-accent-300 rounded-xl flex items-center justify-center">
                  <Users className="h-5 w-5 sm:h-6 sm:w-6 text-accent-700" />
                </div>
                <div className="ml-3 sm:ml-4">
                  <p className="text-xs sm:text-sm font-medium text-gray-500 uppercase tracking-wide">
                    Rides Created
                  </p>
                  <p className="text-xl sm:text-2xl font-bold text-gray-900">
                    {userRides.length}
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl p-4 sm:p-6 shadow-soft hover:shadow-medium transition-all duration-300 border border-gray-100">
              <div className="flex items-center">
                <div className="w-10 h-10 sm:w-12 sm:h-12 bg-gradient-to-br from-secondary-200 to-secondary-300 rounded-xl flex items-center justify-center">
                  <MapPin className="h-5 w-5 sm:h-6 sm:w-6 text-secondary-700" />
                </div>
                <div className="ml-3 sm:ml-4">
                  <p className="text-xs sm:text-sm font-medium text-gray-500 uppercase tracking-wide">
                    Rides Joined
                  </p>
                  <p className="text-xl sm:text-2xl font-bold text-gray-900">
                    {dashboardUserRides.filter(
                      (ride) => displayUser && ride.creator !== displayUser.id && ride.passengers.includes(displayUser.id)
                    ).length}
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl p-4 sm:p-6 shadow-soft hover:shadow-medium transition-all duration-300 border border-gray-100">
              <div className="flex items-center">
                <div className="w-10 h-10 sm:w-12 sm:h-12 bg-gradient-to-br from-green-200 to-green-300 rounded-xl flex items-center justify-center">
                  <Clock className="h-5 w-5 sm:h-6 sm:w-6 text-green-700" />
                </div>
                <div className="ml-3 sm:ml-4">
                  <p className="text-xs sm:text-sm font-medium text-gray-500 uppercase tracking-wide">
                    Active Rides
                  </p>
                  <p className="text-xl sm:text-2xl font-bold text-gray-900">
                    {activeRides.length}
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl p-4 sm:p-6 shadow-soft hover:shadow-medium transition-all duration-300 border border-gray-100">
              <div className="flex items-center">
                <div className="w-10 h-10 sm:w-12 sm:h-12 bg-gradient-to-br from-purple-200 to-purple-300 rounded-xl flex items-center justify-center">
                  <TrendingUp className="h-5 w-5 sm:h-6 sm:w-6 text-purple-700" />
                </div>
                <div className="ml-3 sm:ml-4">
                  <p className="text-xs sm:text-sm font-medium text-gray-500 uppercase tracking-wide">
                    Total Rides
                  </p>
                  <p className="text-xl sm:text-2xl font-bold text-gray-900">
                    {userRides.length + dashboardUserRides.filter(
                      (ride) => displayUser && ride.creator !== displayUser.id && ride.passengers.includes(displayUser.id)
                    ).length}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Active Rides Section */}
          <div className="mb-8 sm:mb-12">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
              <h2 className="text-2xl sm:text-3xl font-bold text-gray-900">
                Your Rides
              </h2>
              <Link
                to="/create-ride"
                className="btn-modern px-4 sm:px-6 py-2 sm:py-3 bg-gradient-to-r from-accent-400 to-accent-500 hover:from-accent-500 hover:to-accent-600 text-white text-sm font-semibold rounded-xl transition-all duration-300 transform hover:scale-105 shadow-medium hover:shadow-large flex items-center gap-2"
              >
                <Plus className="h-4 w-4" />
                Create New Ride
              </Link>
            </div>
            
            {userRides.length > 0 ? (
              <RideList
                rides={userRides}
                showActions={true}
                emptyMessage="You haven't created any rides yet."
              />
            ) : (
              <div className="bg-white rounded-2xl p-8 sm:p-12 text-center shadow-soft border border-gray-100">
                <div className="w-16 h-16 sm:w-20 sm:h-20 bg-gradient-to-br from-accent-200 to-accent-300 rounded-2xl flex items-center justify-center mx-auto mb-4 sm:mb-6">
                  <Plus className="h-8 w-8 sm:h-10 sm:w-10 text-accent-700" />
                </div>
                <h3 className="text-xl sm:text-2xl font-bold text-gray-900 mb-2 sm:mb-4">
                  No rides created yet
                </h3>
                <p className="text-gray-600 mb-6 sm:mb-8 max-w-md mx-auto">
                  Start your journey by creating your first ride. Share your
                  route with others and split the cost!
                </p>
                <Link
                  to="/create-ride"
                  className="btn-modern inline-flex items-center px-6 sm:px-8 py-3 sm:py-4 bg-gradient-to-r from-accent-400 to-accent-500 hover:from-accent-500 hover:to-accent-600 text-white font-semibold rounded-2xl transition-all duration-300 transform hover:scale-105 shadow-medium hover:shadow-large gap-2"
                >
                  <Plus className="h-4 w-4 sm:h-5 sm:w-5" />
                  Create Your First Ride
                </Link>
              </div>
            )}
          </div>

          {/* Joined Rides Section */}
          <div>
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl sm:text-3xl font-bold text-gray-900">
                Joined Rides
              </h2>
              <Link
                to="/rides"
                className="px-4 sm:px-6 py-2 sm:py-3 bg-white text-accent-600 border-2 border-accent-200 hover:border-accent-400 text-sm font-semibold rounded-xl transition-all duration-300 hover:bg-accent-50 flex items-center gap-2"
              >
                <MapPin className="h-4 w-4" />
                Find More Rides
              </Link>
            </div>
            
            {dashboardUserRides.filter(
              (ride) => displayUser && ride.creator !== displayUser.id && ride.passengers.includes(displayUser.id)
            ).length > 0 ? (
              <RideList
                rides={dashboardUserRides.filter(
                  (ride) => displayUser && ride.creator !== displayUser.id && ride.passengers.includes(displayUser.id)
                )}
                showActions={true}
                emptyMessage="You haven't joined any rides yet."
              />
            ) : (
              <div className="bg-white rounded-2xl p-8 sm:p-12 text-center shadow-soft border border-gray-100">
                <div className="w-16 h-16 sm:w-20 sm:h-20 bg-gradient-to-br from-secondary-200 to-secondary-300 rounded-2xl flex items-center justify-center mx-auto mb-4 sm:mb-6">
                  <MapPin className="h-8 w-8 sm:h-10 sm:w-10 text-secondary-700" />
                </div>
                <h3 className="text-xl sm:text-2xl font-bold text-gray-900 mb-2 sm:mb-4">
                  No rides joined yet
                </h3>
                <p className="text-gray-600 mb-6 sm:mb-8 max-w-md mx-auto">
                  Find rides going your way and connect with fellow travelers.
                  Save money and make new friends!
                </p>
                <Link
                  to="/rides"
                  className="inline-flex items-center px-6 sm:px-8 py-3 sm:py-4 bg-white text-accent-600 border-2 border-accent-200 hover:border-accent-400 font-semibold rounded-2xl transition-all duration-300 hover:bg-accent-50 gap-2"
                >
                  <MapPin className="h-4 w-4 sm:h-5 sm:w-5" />
                  Find Rides Near You
                </Link>
              </div>
            )}
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
};

export default DashboardPage;
