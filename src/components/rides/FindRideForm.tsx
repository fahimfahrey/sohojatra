import React, { useState, useEffect, useCallback } from "react";
import { useRide } from "../../contexts/RideContext";
import { useAbly } from "../../contexts/AblyContext";
import { Search, MapPin, Filter, Car, X } from "lucide-react";
import { Location, RideRequest, VehicleType } from "../../types";
import GlobalMap from "../map/GlobalMap";
import RideList from "./RideList";
import VehicleSelector from "./VehicleSelector";

const FindRideForm: React.FC = () => {
  const [startingPoint, setStartingPoint] = useState<Location | null>(null);
  const [destination, setDestination] = useState<Location | null>(null);
  const [allMatchingRides, setAllMatchingRides] = useState<RideRequest[]>([]);
  const [filteredRides, setFilteredRides] = useState<RideRequest[]>([]);
  const [searched, setSearched] = useState(false);
  const [selectedVehicle, setSelectedVehicle] = useState<VehicleType | null>(null);
  const [showVehicleFilter, setShowVehicleFilter] = useState(false);

  const { findMatchingRides, refreshAllRides } = useRide();
  const { subscribeToEvent } = useAbly();

  // Function to refresh matching rides - memoized to avoid recreating on every render
  const refreshMatchingRides = useCallback(async () => {
    if (searched && startingPoint && destination) {
      console.log("Refreshing ride matches...");

      // First refresh the full database data to ensure we have the latest rides
      await refreshAllRides();

      // Get all matching rides without vehicle filter
      const updatedRides = findMatchingRides(startingPoint, destination, null);
      console.log(`Found ${updatedRides.length} total matching rides`);

      // Update the all matching rides
      setAllMatchingRides(updatedRides);

      // Apply vehicle filter if selected
      if (selectedVehicle) {
        const vehicleFilteredRides = updatedRides.filter(
          (ride) => ride.vehicle === selectedVehicle
        );
        console.log(`After vehicle filter (${selectedVehicle}): ${vehicleFilteredRides.length} rides`);
        setFilteredRides(vehicleFilteredRides);
      } else {
        setFilteredRides(updatedRides);
      }
    }
  }, [
    searched,
    startingPoint,
    destination,
    selectedVehicle,
    findMatchingRides,
    refreshAllRides,
  ]);

  // Apply vehicle filter when vehicle selection changes
  useEffect(() => {
    if (searched && allMatchingRides.length > 0) {
      if (selectedVehicle) {
        const vehicleFilteredRides = allMatchingRides.filter(
          (ride) => ride.vehicle === selectedVehicle
        );
        console.log(`Vehicle filter applied (${selectedVehicle}): ${vehicleFilteredRides.length} rides`);
        setFilteredRides(vehicleFilteredRides);
      } else {
        console.log("Vehicle filter cleared, showing all rides");
        setFilteredRides(allMatchingRides);
      }
    }
  }, [selectedVehicle, allMatchingRides, searched]);

  // Event handlers - moved outside useEffect and memoized
  const handleNewRide = useCallback(() => {
    console.log("New ride created event received");
    refreshMatchingRides();
  }, [refreshMatchingRides]);

  const handleUpdateRide = useCallback(() => {
    console.log("Ride update event received");
    refreshMatchingRides();
  }, [refreshMatchingRides]);

  const handleSyncEvent = useCallback(() => {
    console.log("Sync event received");
    // Wait a moment to allow the database to update before refreshing
    setTimeout(() => refreshMatchingRides(), 300);
  }, [refreshMatchingRides]);

  const handleGenericEvent = useCallback(() => {
    refreshMatchingRides();
  }, [refreshMatchingRides]);

  // Always subscribe to ride updates regardless of search state
  useEffect(() => {
    console.log("Setting up real-time ride update subscriptions");

    // Subscribe to all ride events that might affect our results
    const unsubscribeNew = subscribeToEvent("rides", "new", handleNewRide);
    const unsubscribeUpdate = subscribeToEvent(
      "rides",
      "update",
      handleUpdateRide
    );
    const unsubscribeJoin = subscribeToEvent(
      "rides",
      "join",
      handleGenericEvent
    );
    const unsubscribeLeave = subscribeToEvent(
      "rides",
      "leave",
      handleGenericEvent
    );
    const unsubscribeSync = subscribeToEvent("rides", "sync", handleSyncEvent);

    // Immediate refresh when subscriptions are set up
    if (searched && startingPoint && destination) {
      refreshMatchingRides();
    }

    return () => {
      console.log("Cleaning up ride subscriptions");
      unsubscribeNew();
      unsubscribeUpdate();
      unsubscribeJoin();
      unsubscribeLeave();
      unsubscribeSync();
    };
  }, [
    refreshMatchingRides,
    subscribeToEvent,
    searched,
    startingPoint,
    destination,
    handleNewRide,
    handleUpdateRide,
    handleGenericEvent,
    handleSyncEvent,
  ]);

  // Refresh the ride list periodically - modified to use ref to avoid resubscription
  useEffect(() => {
    if (!searched || !startingPoint || !destination) return;

    console.log("Setting up periodic ride refresh interval");
    const refreshInterval = setInterval(refreshMatchingRides, 10000); // Refresh every 10 seconds

    return () => {
      console.log("Cleaning up periodic refresh interval");
      clearInterval(refreshInterval);
    };
  }, [searched, startingPoint, destination, refreshMatchingRides]);

  const handleSearch = async () => {
    window.scrollTo({
      top: screen.height + 800,
      behavior: "smooth",
    });
    if (!startingPoint || !destination) {
      return;
    }

    setSearched(true);
    setShowVehicleFilter(false); // Hide vehicle filter initially
    setSelectedVehicle(null); // Clear any previous vehicle selection

    // First refresh the full database data to ensure we have the latest rides
    await refreshAllRides();


    // Get all matching rides without vehicle filter
    const rides = findMatchingRides(startingPoint, destination, null);
    setAllMatchingRides(rides);
    setFilteredRides(rides);

  };

  const clearSearch = () => {
    setStartingPoint(null);
    setDestination(null);
    setAllMatchingRides([]);
    setFilteredRides([]);
    setSearched(false);
    setSelectedVehicle(null);
    setShowVehicleFilter(false);
  };

  const handleVehicleFilterToggle = () => {
    if (showVehicleFilter) {
      // Hiding vehicle filter - clear selection and show all rides
      setSelectedVehicle(null);
      setFilteredRides(allMatchingRides);
    }
    setShowVehicleFilter(!showVehicleFilter);
  };

  const handleVehicleChange = (vehicle: VehicleType) => {
    setSelectedVehicle(vehicle);
    // The useEffect will handle filtering
  };

  const clearVehicleFilter = () => {
    setSelectedVehicle(null);
    // The useEffect will handle showing all rides
  };

  const getVehicleIcon = (vehicle: string) => {
    const icons: { [key: string]: string } = {
      "Rickshaw": "🚲",
      "CNG": "🛺",
      "Bike": "🏍️",
      "Bus": "🚌",
      "Car": "🚗",
      "Uber/Pathao": "📱"
    };
    return icons[vehicle] || "🚗";
  };

  // Get unique vehicle types from all matching rides
  const getAvailableVehicleTypes = (): VehicleType[] => {
    const vehicleTypes = [...new Set(allMatchingRides.map(ride => ride.vehicle).filter(Boolean))];
    return vehicleTypes as VehicleType[];
  };

  return (
    <div className="w-full max-w-7xl mx-auto">
      <div className="bg-white shadow-large rounded-2xl sm:rounded-3xl overflow-hidden border border-gray-100">
        <div className="p-4 sm:p-6 lg:p-8">
          
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 lg:gap-8">
            {/* Map Section */}
            <div className="space-y-4 sm:space-y-6">
              <div className="bg-gray-50 rounded-xl sm:rounded-2xl overflow-hidden border border-gray-200">
                <GlobalMap
                  startingPoint={startingPoint}
                  destination={destination}
                  onStartingPointChange={setStartingPoint}
                  onDestinationChange={setDestination}
                  height="300px sm:400px"
                />
              </div>

              {/* Search Controls */}
              <div className="flex flex-col gap-3">
                <button
                  onClick={handleSearch}
                  disabled={!startingPoint || !destination}
                  className="btn-modern w-full py-3 px-6 bg-gradient-to-r from-accent-400 to-accent-500 hover:from-accent-500 hover:to-accent-600 text-white font-semibold rounded-xl sm:rounded-2xl transition-all duration-300 transform hover:scale-105 shadow-medium hover:shadow-large disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none flex items-center justify-center gap-3"
                >
                  <Search className="w-4 h-4 sm:w-5 sm:h-5" />
                  <span className="text-sm sm:text-base">Search Rides</span>
                </button>
                <button
                  onClick={clearSearch}
                  className="w-full px-6 py-3 bg-gray-100 text-gray-700 font-semibold rounded-xl sm:rounded-2xl hover:bg-gray-200 transition-all duration-200 flex items-center justify-center gap-2"
                >
                  <Filter className="w-4 h-4 sm:w-5 sm:h-5" />
                  <span className="text-sm sm:text-base">Clear Search</span>
                </button>
              </div>
            </div>

            {/* Search Details Panel */}
            <div className="space-y-4 sm:space-y-6">
              <div className="bg-gradient-to-br from-secondary-50 to-accent-50 rounded-xl sm:rounded-2xl p-4 sm:p-6 border border-gray-200">
                <h3 className="text-lg sm:text-xl font-bold text-gray-900 mb-4 sm:mb-6 flex items-center">
                  <MapPin className="h-5 w-5 sm:h-6 sm:w-6 text-secondary-600 mr-2 sm:mr-3" />
                  Search Details
                </h3>

                {startingPoint ? (
                  <div className="mb-4 sm:mb-6 p-3 sm:p-4 bg-white rounded-lg sm:rounded-xl border border-gray-200">
                    <p className="text-xs sm:text-sm font-semibold text-gray-700 mb-2">
                      Starting Point:
                    </p>
                    <p className="text-sm sm:text-base text-gray-900 font-medium break-words">
                      {startingPoint.address}
                    </p>
                  </div>
                ) : (
                  <div className="mb-4 sm:mb-6 p-3 sm:p-4 bg-gray-100 rounded-lg sm:rounded-xl border-2 border-dashed border-gray-300">
                    <p className="text-xs sm:text-sm text-gray-500 text-center">
                      📍 Select your starting point on the map
                    </p>
                  </div>
                )}

                {destination ? (
                  <div className="mb-4 sm:mb-6 p-3 sm:p-4 bg-white rounded-lg sm:rounded-xl border border-gray-200">
                    <p className="text-xs sm:text-sm font-semibold text-gray-700 mb-2">
                      Destination:
                    </p>
                    <p className="text-sm sm:text-base text-gray-900 font-medium break-words">
                      {destination.address}
                    </p>
                  </div>
                ) : (
                  <div className="mb-4 sm:mb-6 p-3 sm:p-4 bg-gray-100 rounded-lg sm:rounded-xl border-2 border-dashed border-gray-300">
                    <p className="text-xs sm:text-sm text-gray-500 text-center">
                      🎯 Select your destination on the map
                    </p>
                  </div>
                )}

                {searched && (
                  <div className="p-3 sm:p-4 bg-white rounded-lg sm:rounded-xl border border-gray-200">
                    <p className="text-xs sm:text-sm font-semibold text-gray-700 mb-2">
                      Search Results:
                    </p>
                    <p className="text-sm sm:text-base text-gray-900 font-medium">
                      {filteredRides.length} ride{filteredRides.length !== 1 ? 's' : ''} found
                      {selectedVehicle ? ` (${selectedVehicle} only)` : ` (all vehicles)`}
                    </p>
                    {allMatchingRides.length !== filteredRides.length && (
                      <p className="text-xs text-gray-500 mt-1">
                        {allMatchingRides.length} total rides found for this route
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Help Section */}
              <div className="bg-blue-50 rounded-xl sm:rounded-2xl p-4 sm:p-6 border border-blue-200">
                <h4 className="text-base sm:text-lg font-semibold text-blue-800 mb-3 sm:mb-4">
                  💡 Search Tips
                </h4>
                <ul className="space-y-2 sm:space-y-3 text-blue-700">
                  <li className="flex items-start text-sm sm:text-base">
                    <span className="text-blue-500 mr-2 flex-shrink-0">•</span>
                    <span>First search by route to see all available rides</span>
                  </li>
                  <li className="flex items-start text-sm sm:text-base">
                    <span className="text-blue-500 mr-2 flex-shrink-0">•</span>
                    <span>Then use vehicle filter to narrow down your options</span>
                  </li>
                  <li className="flex items-start text-sm sm:text-base">
                    <span className="text-blue-500 mr-2 flex-shrink-0">•</span>
                    <span>Click anywhere on the map to set locations</span>
                  </li>
                  <li className="flex items-start text-sm sm:text-base">
                    <span className="text-blue-500 mr-2 flex-shrink-0">•</span>
                    <span>Drag markers to refine exact positions</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Search Results */}
      {searched && (
        <div className="mt-6 sm:mt-8">
          <div className="bg-white shadow-large rounded-2xl sm:rounded-3xl p-4 sm:p-6 lg:p-8 border border-gray-100">
            {/* Results Header with Vehicle Filter Toggle */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 sm:mb-8">
              <div>
                <h3 className="text-xl sm:text-2xl font-bold text-gray-900 mb-2">
                  {filteredRides.length > 0
                    ? `Found ${filteredRides.length} matching ride${filteredRides.length !== 1 ? 's' : ''}`
                    : "No matching rides found"}
                </h3>
                <p className="text-sm sm:text-base text-gray-600">
                  {filteredRides.length > 0 ? (
                    <>Here are the rides that match your route{selectedVehicle && ` with ${selectedVehicle}`}</>
                  ) : (
                    <>Try adjusting your route{selectedVehicle && ', changing vehicle filter,'} or create a new ride request</>
                  )}
                </p>
              </div>

              {/* Vehicle Filter Button - Only show if there are rides */}
              {allMatchingRides.length > 0 && (
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleVehicleFilterToggle}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all duration-200 ${
                      showVehicleFilter
                        ? 'bg-blue-100 text-blue-700 border border-blue-300'
                        : 'bg-gray-100 text-gray-700 border border-gray-300 hover:bg-gray-200'
                    }`}
                  >
                    <Car className="w-4 h-4" />
                    <span className="text-sm">
                      {showVehicleFilter ? 'Hide' : 'Filter by'} Vehicle
                    </span>
                    {showVehicleFilter && <X className="w-4 h-4" />}
                  </button>
                </div>
              )}
            </div>

            {/* Vehicle Filter Section */}
            {showVehicleFilter && allMatchingRides.length > 0 && (
              <div className="mb-6 sm:mb-8 bg-blue-50 rounded-xl sm:rounded-2xl p-4 sm:p-6 border border-blue-200">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="text-base sm:text-lg font-semibold text-blue-800">
                    Filter by Vehicle Type
                  </h4>
                  {selectedVehicle && (
                    <button
                      onClick={clearVehicleFilter}
                      className="text-sm text-blue-600 hover:text-blue-800 font-medium"
                    >
                      Clear Filter
                    </button>
                  )}
                </div>

                {/* Available Vehicle Types */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {getAvailableVehicleTypes().map((vehicleType) => {
                    const rideCount = allMatchingRides.filter(ride => ride.vehicle === vehicleType).length;
                    return (
                      <button
                        key={vehicleType}
                        onClick={() => handleVehicleChange(vehicleType)}
                        className={`p-3 rounded-lg border-2 transition-all duration-200 ${
                          selectedVehicle === vehicleType
                            ? 'border-blue-500 bg-blue-100 text-blue-800'
                            : 'border-gray-300 bg-white text-gray-700 hover:border-blue-300 hover:bg-blue-50'
                        }`}
                      >
                        <div className="flex flex-col items-center gap-1">
                          <span className="text-lg">{getVehicleIcon(vehicleType)}</span>
                          <span className="text-xs font-medium">{vehicleType}</span>
                          <span className="text-xs text-gray-500">
                            {rideCount} ride{rideCount !== 1 ? 's' : ''}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Current Filter Status */}
                {selectedVehicle && (
                  <div className="mt-4 p-3 bg-white rounded-lg border border-blue-200">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-700">Filtering by:</span>
                        <div className="flex items-center gap-2 px-2 py-1 bg-blue-100 text-blue-800 rounded text-sm">
                          <span>{getVehicleIcon(selectedVehicle)}</span>
                          <span>{selectedVehicle}</span>
                        </div>
                      </div>
                      <span className="text-sm text-gray-600">
                        {filteredRides.length} of {allMatchingRides.length} rides
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Ride List */}
            <RideList
              rides={filteredRides}
              emptyMessage={
                selectedVehicle 
                  ? `No rides found with ${selectedVehicle} for this route. Try selecting a different vehicle type or clear the filter.`
                  : `No rides match your route. Would you like to create a new ride request?`
              }
            />

            {/* Create New Ride CTA */}
            {filteredRides.length === 0 && (
              <div className="mt-6 sm:mt-8 text-center">
                <a
                  href="/create-ride"
                  className="btn-modern inline-flex items-center px-6 sm:px-8 py-3 sm:py-4 bg-gradient-to-r from-accent-400 to-accent-500 hover:from-accent-500 hover:to-accent-600 text-white font-semibold rounded-xl sm:rounded-2xl transition-all duration-300 transform hover:scale-105 shadow-medium text-sm sm:text-base"
                >
                  Create a New Ride Request
                </a>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default FindRideForm;