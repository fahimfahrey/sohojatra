import React, { useState, useEffect } from "react";
import { useRide } from "../../contexts/RideContext";
import { useNavigate } from "react-router-dom";
import { toast } from "react-hot-toast";
import { Location, VehicleType } from "../../types";
import GlobalMap from "../map/GlobalMap";
import { useNotification } from "../../contexts/NotificationContext";
import PhoneNumberModal from "./PhoneNumberModal";
import VehicleSelector from "./VehicleSelector";
import { MapPin, Users, ArrowRight, Car } from "lucide-react";

const CreateRideForm: React.FC = () => {
  const [startingPoint, setStartingPoint] = useState<Location | null>(null);
  const [destination, setDestination] = useState<Location | null>(null);
  const [totalSeats, setTotalSeats] = useState<number>(2);
  const [selectedVehicle, setSelectedVehicle] = useState<VehicleType>("CNG");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPhoneModal, setShowPhoneModal] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState<string>("");

  const { createRideRequest } = useRide();
  const { addNotification } = useNotification();
  const navigate = useNavigate();

  // Function to get available seat options based on vehicle type
  const getAvailableSeats = (vehicle: VehicleType): number[] => {
    switch (vehicle) {
      case "Rickshaw":
      case "CNG":
      case "Bike":
        return [2, 3];
      case "Uber/Pathao":
        return [2, 3, 4, 5];
      default:
        return [2, 3, 4, 5]; // fallback for any other vehicle types
    }
  };

  // Reset total seats when vehicle changes to ensure valid selection
  useEffect(() => {
    const availableSeats = getAvailableSeats(selectedVehicle);
    if (!availableSeats.includes(totalSeats)) {
      setTotalSeats(availableSeats[0]); // Set to the first available option
    }
  }, [selectedVehicle, totalSeats]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!startingPoint || !destination) {
      toast.error("Please select both starting point and destination");
      return;
    }

    // Show phone number modal instead of submitting directly
    setShowPhoneModal(true);
  };

  const handlePhoneSubmit = async (phone: string) => {
    setPhoneNumber(phone);
    setShowPhoneModal(false);
    setIsSubmitting(true);

    try {
      const newRide = await createRideRequest(
        startingPoint!,
        destination!,
        totalSeats,
        phone,
        selectedVehicle
      );
      toast.success("Ride request created successfully!");
      addNotification(
        `Your ride request to ${destination!.address} has been created.`,
        "system",
        newRide.id
      );
      navigate("/dashboard");
    } catch (error) {
      toast.error("Failed to create ride request");
      console.error(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const availableSeats = getAvailableSeats(selectedVehicle);

  return (
    <div className="w-full max-w-7xl mx-auto">
      <div className="bg-white shadow-large rounded-2xl sm:rounded-3xl overflow-hidden border border-gray-100">
        <div className="p-4 sm:p-6 lg:p-8">
          
          <form onSubmit={handleSubmit}>
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

                {/* Vehicle Selection */}
                <div className="bg-blue-50 rounded-xl sm:rounded-2xl p-4 sm:p-6 border border-blue-200">
                  <div className="flex items-center mb-3 sm:mb-4">
                    <Car className="h-5 w-5 sm:h-6 sm:w-6 text-blue-600 mr-2 sm:mr-3" />
                    <h3 className="text-base sm:text-lg font-semibold text-gray-900">
                      Vehicle Type
                    </h3>
                  </div>
                  <VehicleSelector
                    selectedVehicle={selectedVehicle}
                    onVehicleChange={setSelectedVehicle}
                  />
                </div>

                {/* Seat Selection */}
                <div className="bg-accent-50 rounded-xl sm:rounded-2xl p-4 sm:p-6 border border-accent-200">
                  <div className="flex items-center mb-3 sm:mb-4">
                    <Users className="h-5 w-5 sm:h-6 sm:w-6 text-accent-600 mr-2 sm:mr-3" />
                    <label className="text-base sm:text-lg font-semibold text-gray-900">
                      Total Seats (including you)
                    </label>
                  </div>
                  <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 sm:gap-3">
                    {availableSeats.map((seats) => (
                      <button
                        key={seats}
                        type="button"
                        onClick={() => setTotalSeats(seats)}
                        className={`px-4 sm:px-6 py-2 sm:py-3 rounded-lg sm:rounded-xl font-semibold transition-all duration-200 text-sm sm:text-base ${
                          totalSeats === seats
                            ? "bg-accent-500 text-white shadow-medium transform scale-105"
                            : "bg-white text-accent-600 border-2 border-accent-200 hover:border-accent-400 hover:bg-accent-50"
                        }`}
                      >
                        {seats} seats
                      </button>
                    ))}
                  </div>
                  <div className="mt-3 sm:mt-4 text-xs sm:text-sm text-accent-700 bg-accent-100 p-2 sm:p-3 rounded-lg sm:rounded-xl">
                    <p className="mb-1">
                      💡 <strong>Seat capacity for {selectedVehicle}:</strong>
                    </p>
                    <p>
                      {selectedVehicle === "Rickshaw" && "Traditional rickshaws typically accommodate 2-3 passengers"}
                      {selectedVehicle === "CNG" && "CNG auto-rickshaws can comfortably fit 2-3 passengers"}
                      {selectedVehicle === "Bike" && "Motorbike rides are suitable for 2-3 people (including driver)"}
                      {selectedVehicle === "Uber/Pathao" && "Ride-sharing cars can accommodate 2-5 passengers depending on the vehicle"}
                    </p>
                  </div>
                </div>

                {/* Submit Button */}
                <button
                  type="submit"
                  className="btn-modern w-full py-3 sm:py-4 px-4 sm:px-6 bg-gradient-to-r from-accent-400 to-accent-500 hover:from-accent-500 hover:to-accent-600 text-white font-semibold rounded-xl sm:rounded-2xl transition-all duration-300 transform hover:scale-105 shadow-medium hover:shadow-large disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none flex items-center justify-center gap-2 sm:gap-3"
                  disabled={isSubmitting || !startingPoint || !destination}
                >
                  {isSubmitting ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 sm:h-5 sm:w-5 border-t-2 border-b-2 border-white"></div>
                      <span className="text-sm sm:text-base">Creating Ride...</span>
                    </>
                  ) : (
                    <>
                      <span className="text-sm sm:text-base">Create Ride Request</span>
                      <ArrowRight className="w-4 h-4 sm:w-5 sm:h-5" />
                    </>
                  )}
                </button>
              </div>

              {/* Details Panel */}
              <div className="space-y-4 sm:space-y-6">
                <div className="bg-gradient-to-br from-secondary-50 to-accent-50 rounded-xl sm:rounded-2xl p-4 sm:p-6 border border-gray-200">
                  <h3 className="text-lg sm:text-xl font-bold text-gray-900 mb-4 sm:mb-6 flex items-center">
                    <MapPin className="h-5 w-5 sm:h-6 sm:w-6 text-secondary-600 mr-2 sm:mr-3" />
                    Ride Summary
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

                  <div className="mb-4 sm:mb-6 p-3 sm:p-4 bg-white rounded-lg sm:rounded-xl border border-gray-200">
                    <p className="text-xs sm:text-sm font-semibold text-gray-700 mb-2">
                      Vehicle Type:
                    </p>
                    <div className="flex items-center space-x-2">
                      <span className="text-lg">
                        {selectedVehicle === "Rickshaw" && "🚲"}
                        {selectedVehicle === "CNG" && "🛺"}
                        {selectedVehicle === "Bike" && "🏍️"}
                        {selectedVehicle === "Uber/Pathao" && "📱"}
                      </span>
                      <span className="text-sm sm:text-base text-gray-900 font-medium">
                        {selectedVehicle}
                      </span>
                    </div>
                  </div>

                  <div className="p-3 sm:p-4 bg-white rounded-lg sm:rounded-xl border border-gray-200">
                    <p className="text-xs sm:text-sm font-semibold text-gray-700 mb-2">
                      Available Seats:
                    </p>
                    <p className="text-sm sm:text-base text-gray-900 font-medium">
                      {totalSeats} passengers total (including you)
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      {totalSeats - 1} seats available for other passengers
                    </p>
                  </div>
                </div>

                {/* Help Section */}
                <div className="bg-amber-50 rounded-xl sm:rounded-2xl p-4 sm:p-6 border border-amber-200">
                  <h4 className="text-base sm:text-lg font-semibold text-amber-800 mb-3 sm:mb-4">
                    📚 Quick Guide
                  </h4>
                  <ul className="space-y-2 sm:space-y-3 text-amber-700">
                    <li className="flex items-start text-sm sm:text-base">
                      <span className="text-amber-500 mr-2 flex-shrink-0">•</span>
                      <span>Use the search box to find locations quickly</span>
                    </li>
                    <li className="flex items-start text-sm sm:text-base">
                      <span className="text-amber-500 mr-2 flex-shrink-0">•</span>
                      <span>Choose the vehicle type you plan to use</span>
                    </li>
                    <li className="flex items-start text-sm sm:text-base">
                      <span className="text-amber-500 mr-2 flex-shrink-0">•</span>
                      <span>Seat options adjust based on vehicle capacity</span>
                    </li>
                    <li className="flex items-start text-sm sm:text-base">
                      <span className="text-amber-500 mr-2 flex-shrink-0">•</span>
                      <span>Drag markers to adjust exact pickup points</span>
                    </li>
                  </ul>
                </div>

                {/* Important Notice */}
                <div className="bg-blue-50 rounded-xl sm:rounded-2xl p-4 sm:p-6 border border-blue-200">
                  <h4 className="text-base sm:text-lg font-semibold text-blue-800 mb-2 sm:mb-3">
                    ℹ️ Important Notice
                  </h4>
                  <p className="text-blue-700 text-sm sm:text-base leading-relaxed">
                    This app helps you find co-passengers. You'll need to arrange for a ride offline once your group is formed. We recommend meeting at the starting point 10 minutes before departure.
                  </p>
                </div>
              </div>
            </div>
          </form>
        </div>
      </div>

      {/* Phone Number Modal */}
      <PhoneNumberModal
        isOpen={showPhoneModal}
        onClose={() => setShowPhoneModal(false)}
        onSubmit={handlePhoneSubmit}
      />
    </div>
  );
};

export default CreateRideForm;