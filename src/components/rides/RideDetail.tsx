import React, { useState, useEffect, useCallback } from "react";
import { RideRequest } from "../../types";
import { MapPin, Car, Navigation, Users, Calendar, User, Phone, Clock, CheckCircle } from "lucide-react";
import RideMap from "../map/RideMap";
import { useAuth } from "../../contexts/AuthContext";
import { useRide } from "../../contexts/RideContext";
import { toast } from "react-hot-toast";
import { useNavigate } from "react-router-dom";
import { useNotification } from "../../contexts/NotificationContext";
import PhoneNumberModal from "./PhoneNumberModal";
import { supabase } from "../../lib/supabase";

interface RideDetailProps {
  ride: RideRequest;
}

// New interface for passenger info including phone
interface PassengerInfo {
  id: string;
  isCreator: boolean;
  contactPhone?: string;
}

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

const RideDetail: React.FC<RideDetailProps> = ({ ride }) => {
  const { user } = useAuth();
  const {
    joinRideRequest,
    cancelRideRequest,
    completeRideRequest,
    syncRideStatus,
  } = useRide();
  const { addNotification } = useNotification();
  const navigate = useNavigate();
  const [showPhoneModal, setShowPhoneModal] = useState(false);
  const [passengers, setPassengers] = useState<PassengerInfo[]>([]);
  const [isJoining] = useState(false);
  const [isLeaving] = useState(false);
  const [isCompleting] = useState(false);

  const isCreator = user && ride.creator === user.id;
  const isPassenger = user && ride.passengers.includes(user.id);
  const canJoin =
    user && !isPassenger && ride.status === "open" && ride.seatsAvailable > 0;
  const canLeaveOrCancel =
    isPassenger && ride.status !== "completed" && ride.status !== "cancelled";
  const canComplete =
    isCreator && ride.status !== "completed" && ride.status !== "cancelled";

  // Sync ride status when component mounts or ride id changes
  useEffect(() => {
    if (ride.id) {
      syncRideStatus(ride.id);
    }
  }, [ride.id, syncRideStatus]);

  // Fetch passengers info - memoized to avoid unnecessary rerenders
  const fetchPassengersInfo = useCallback(async () => {
    try {
      // Get passenger info including phone numbers
      const { data, error } = await supabase
        .from("ride_passengers")
        .select("user_id, contact_phone")
        .eq("ride_id", ride.id);

      if (error) {
        console.error("Error fetching passengers:", error);
        // Create fallback passenger data using the ride's passengers array
        const fallbackPassengers: PassengerInfo[] = ride.passengers.map(
          (passengerId) => ({
            id: passengerId,
            isCreator: passengerId === ride.creator,
            contactPhone:
              passengerId === ride.creator ? ride.contactPhone : undefined,
          })
        );
        setPassengers(fallbackPassengers);
        return;
      }

      // Map passengers data with creator flag
      const passengersInfo: PassengerInfo[] = data.map((passenger) => ({
        id: passenger.user_id,
        isCreator: passenger.user_id === ride.creator,
        contactPhone: passenger.contact_phone,
      }));

      setPassengers(passengersInfo);
    } catch (err) {
      console.error("Error fetching passenger details:", err);
      // Create fallback passenger data
      const fallbackPassengers: PassengerInfo[] = ride.passengers.map(
        (passengerId) => ({
          id: passengerId,
          isCreator: passengerId === ride.creator,
          contactPhone:
            passengerId === ride.creator ? ride.contactPhone : undefined,
        })
      );
      setPassengers(fallbackPassengers);
    }
  }, [ride.id, ride.passengers, ride.creator, ride.contactPhone]);

  // Fetch passengers when ride info changes
  useEffect(() => {
    if (ride.id) {
      fetchPassengersInfo();
    }
  }, [ride.id, fetchPassengersInfo]);

  const formatDateTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getStatusBadge = (status: string) => {
    const badges = {
      open: "bg-green-100 text-green-800 border-green-200",
      full: "bg-blue-100 text-blue-800 border-blue-200",
      completed: "bg-gray-100 text-gray-800 border-gray-200",
      cancelled: "bg-red-100 text-red-800 border-red-200",
    };
    
    const statusText = {
      open: "Open for Passengers",
      full: "Fully Booked",
      completed: "Ride Completed",
      cancelled: "Ride Cancelled",
    };

    return (
      <span className={`inline-flex items-center px-4 py-2 rounded-full text-sm font-semibold border ${badges[status as keyof typeof badges] || badges.open}`}>
        {statusText[status as keyof typeof statusText] || "Unknown Status"}
      </span>
    );
  };

  const handleJoinRideClick = () => {
    // Sync status before showing join modal
    syncRideStatus(ride.id).then(() => {
      setShowPhoneModal(true);
    });
  };

  const handlePhoneSubmit = async (phoneNumber: string) => {
    setShowPhoneModal(false);
    try {
      // Sync status before joining
      await syncRideStatus(ride.id);
      await joinRideRequest(ride.id, phoneNumber);
      addNotification(
        `You have joined a ride to ${ride.destination.address}.`,
        "join",
        ride.id
      );
      toast.success("Successfully joined the ride");

      // Refresh the page to update ride data instead of redirecting to dashboard
      window.location.reload();
    } catch (error) {
      toast.error("Failed to join ride");
      console.error(error);
    }
  };

  const handleCancelRide = async () => {
    try {
      // Sync status before cancelling
      await syncRideStatus(ride.id);
      await cancelRideRequest(ride.id);
      addNotification(
        `You have cancelled your ride to ${ride.destination.address}.`,
        "update",
        ride.id
      );
      toast.success("Ride cancelled successfully");
      navigate("/dashboard");
      window.scrollTo({
        top: 0,
        behavior: "smooth",
      });
    } catch (error) {
      toast.error(
        "Failed to cancel ride. The ride might have already been completed."
      );
      console.error(error);
    }
  };

  const handleCompleteRide = async () => {
    try {
      // Sync status before completing
      await syncRideStatus(ride.id);
      await completeRideRequest(ride.id);
      addNotification(
        `Your ride to ${ride.destination.address} has been completed.`,
        "update",
        ride.id
      );
      toast.success("Ride completed successfully");
      navigate("/dashboard");
      window.scrollTo({
        top: 0,
        behavior: "smooth",
      });
    } catch (error) {
      toast.error("Failed to complete ride");
      console.error(error);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6 sm:space-y-8">
      {/* Main Ride Details Card */}
      <div className="bg-white rounded-2xl sm:rounded-3xl shadow-large border border-gray-100 overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-accent-50 to-accent-100 p-4 sm:p-6 lg:p-8 border-b border-gray-200">
          <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
            <div className="flex items-center space-x-3 sm:space-x-4">
              <div className="w-12 h-12 sm:w-16 sm:h-16 bg-gradient-to-r from-accent-400 to-accent-500 rounded-full flex items-center justify-center flex-shrink-0">
                <Navigation className="h-6 w-6 sm:h-8 sm:w-8 text-white" />
              </div>
              <div>
                <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-gray-900">
                  {isCreator ? "Your Ride Request" : "Ride Details"}
                </h1>
                <div className="flex items-center text-sm sm:text-base text-gray-600 mt-1">
                  <Calendar className="h-4 w-4 sm:h-5 sm:w-5 mr-2 flex-shrink-0" />
                  <span>{formatDateTime(ride.createdAt)}</span>
                </div>
              </div>
            </div>
            <div className="flex-shrink-0 self-start sm:self-center">
              {getStatusBadge(ride.status)}
            </div>
          </div>
        </div>

        <div className="p-4 sm:p-6 lg:p-8">
          {/* Route Information */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8 mb-6 sm:mb-8">
            <div className="space-y-4 sm:space-y-6">
              <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-xl sm:rounded-2xl p-4 sm:p-6 border border-green-200">
                <div className="flex items-start space-x-3 sm:space-x-4">
                  <div className="w-8 h-8 sm:w-10 sm:h-10 bg-green-500 rounded-full flex items-center justify-center flex-shrink-0">
                    <MapPin className="h-4 w-4 sm:h-5 sm:w-5 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs sm:text-sm font-semibold text-green-700 uppercase tracking-wide mb-1">
                      Starting Point
                    </p>
                    <p className="text-sm sm:text-base lg:text-lg font-medium text-green-900 break-words">
                      {ride.startingPoint.address}
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-gradient-to-br from-red-50 to-red-100 rounded-xl sm:rounded-2xl p-4 sm:p-6 border border-red-200">
                <div className="flex items-start space-x-3 sm:space-x-4">
                  <div className="w-8 h-8 sm:w-10 sm:h-10 bg-red-500 rounded-full flex items-center justify-center flex-shrink-0">
                    <MapPin className="h-4 w-4 sm:h-5 sm:w-5 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs sm:text-sm font-semibold text-red-700 uppercase tracking-wide mb-1">
                      Destination
                    </p>
                    <p className="text-sm sm:text-base lg:text-lg font-medium text-red-900 break-words">
                      {ride.destination.address}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Map */}
            <div className="bg-gray-50 rounded-xl sm:rounded-2xl overflow-hidden border border-gray-200">
              <RideMap
                ride={ride}
                height="250px sm:300px lg:350px"
                showRoute={true}
                showCurrentLocation={false}
              />
            </div>
          </div>

          {/* Ride Information Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 mb-6 sm:mb-8">
            <div className="bg-accent-50 rounded-xl sm:rounded-2xl p-4 sm:p-6 border border-accent-200">
              <div className="flex items-center space-x-3 sm:space-x-4">
                <div className="w-10 h-10 sm:w-12 sm:h-12 bg-accent-100 rounded-full flex items-center justify-center">
                  <Users className="h-5 w-5 sm:h-6 sm:w-6 text-accent-600" />
                </div>
                <div>
                  <p className="text-lg sm:text-xl lg:text-2xl font-bold text-gray-900">
                    {ride.seatsAvailable}/{ride.totalSeats}
                  </p>
                  <p className="text-xs sm:text-sm text-accent-700 font-medium">
                    Seats Available
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-secondary-50 rounded-xl sm:rounded-2xl p-4 sm:p-6 border border-secondary-200">
              <div className="flex items-center space-x-3 sm:space-x-4">
                <div className="w-10 h-10 sm:w-12 sm:h-12 bg-secondary-100 rounded-full flex items-center justify-center">
                  <Clock className="h-5 w-5 sm:h-6 sm:w-6 text-secondary-600" />
                </div>
                <div>
                  <p className="text-lg sm:text-xl lg:text-2xl font-bold text-gray-900">
                    {ride.status === "open" ? "Active" : ride.status}
                  </p>
                  <p className="text-xs sm:text-sm text-secondary-700 font-medium">
                    Ride Status
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-blue-50 rounded-xl sm:rounded-2xl p-4 sm:p-6 border border-blue-200 sm:col-span-2 lg:col-span-1">
              <div className="flex items-center space-x-3 sm:space-x-4">
                <div className="w-10 h-10 sm:w-12 sm:h-12 bg-blue-100 rounded-full flex items-center justify-center">
                  <User className="h-5 w-5 sm:h-6 sm:w-6 text-blue-600" />
                </div>
                <div>
                  <p className="text-lg sm:text-xl lg:text-2xl font-bold text-gray-900">
                    {ride.passengers.length}
                  </p>
                  <p className="text-xs sm:text-sm text-blue-700 font-medium">
                    Current Passengers
                  </p>
                </div>
              </div>
            </div>
          </div>


          {/* Vehicle Information */}
          {ride.vehicle && (
            <div className="mb-6 sm:mb-8 bg-purple-50 rounded-xl sm:rounded-2xl p-4 sm:p-6 border border-purple-200">
              <h3 className="text-lg sm:text-xl font-bold text-purple-800 mb-3 sm:mb-4 flex items-center">
                <Car className="h-5 w-5 sm:h-6 sm:w-6 mr-2 sm:mr-3" />
                Vehicle Information
              </h3>
              <div className="bg-white rounded-lg sm:rounded-xl p-4 sm:p-6 border border-purple-200">
                <div className="flex items-center space-x-4">
                  <div className="w-12 h-12 sm:w-16 sm:h-16 bg-purple-100 rounded-full flex items-center justify-center">
                    <span className="text-2xl sm:text-3xl">{getVehicleIcon(ride.vehicle)}</span>
                  </div>
                  <div>
                    <p className="text-lg sm:text-xl font-bold text-gray-900">{ride.vehicle}</p>
                    <p className="text-sm sm:text-base text-gray-600">
                      {ride.vehicle === "Rickshaw" && "Traditional cycle rickshaw - eco-friendly and affordable"}
                      {ride.vehicle === "CNG" && "3-wheeler auto-rickshaw - fast and economical"}
                      {ride.vehicle === "Bike" && "Motorcycle ride - quick for short distances"}
                      {ride.vehicle === "Bus" && "Public bus - cheapest for longer routes"}
                      {ride.vehicle === "Car" && "Private car - comfortable and air-conditioned"}
                      {ride.vehicle === "Uber/Pathao" && "App-based ride sharing - convenient and trackable"}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Contact Information */}
          {(isPassenger || isCreator) && passengers.length > 0 && (
            <div className="mb-6 sm:mb-8 bg-green-50 rounded-xl sm:rounded-2xl p-4 sm:p-6 border border-green-200">
              <h3 className="text-lg sm:text-xl font-bold text-green-800 mb-3 sm:mb-4 flex items-center">
                <Phone className="h-5 w-5 sm:h-6 sm:w-6 mr-2 sm:mr-3" />
                Contact Information
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                {passengers.map((passenger, index) => (
                  <div
                    key={`${passenger.id}-${index}`}
                    className="bg-white rounded-lg sm:rounded-xl p-3 sm:p-4 border border-green-200"
                  >
                    <div className="flex items-center space-x-3">
                      <div className="w-8 h-8 sm:w-10 sm:h-10 bg-green-500 rounded-full flex items-center justify-center">
                        <User className="h-4 w-4 sm:h-5 sm:w-5 text-white" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm sm:text-base font-medium text-gray-900">
                          {passenger.isCreator ? "Creator" : `Passenger ${index + 1}`}
                        </p>
                        <p className="text-xs sm:text-sm text-gray-500">
                          {passenger.id === user?.id ? "You" : "Other user"}
                        </p>
                        {passenger.contactPhone && (
                          <p className="text-xs sm:text-sm font-medium text-green-700 break-all">
                            📞 {passenger.contactPhone}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 p-4 sm:p-6 bg-gray-50 rounded-xl sm:rounded-2xl border border-gray-200">
            {canJoin && (
              <button
                onClick={handleJoinRideClick}
                disabled={isJoining}
                className="w-full sm:flex-1 bg-gradient-to-r from-accent-500 to-accent-600 hover:from-accent-600 hover:to-accent-700 disabled:from-gray-400 disabled:to-gray-500 text-white px-4 sm:px-6 py-3 rounded-lg sm:rounded-xl font-semibold transition-all duration-200 transform hover:scale-105 shadow-medium disabled:transform-none disabled:shadow-none text-sm sm:text-base"
              >
                {isJoining ? (
                  <div className="flex items-center justify-center">
                    <div className="animate-spin rounded-full h-4 w-4 sm:h-5 sm:w-5 border-t-2 border-b-2 border-white mr-2"></div>
                    Joining...
                  </div>
                ) : (
                  "Join This Ride"
                )}
              </button>
            )}

            {canLeaveOrCancel && (
              <button
                onClick={handleCancelRide}
                disabled={isLeaving}
                className="w-full sm:flex-1 bg-gray-100 hover:bg-gray-200 disabled:bg-gray-50 text-gray-700 disabled:text-gray-400 px-4 sm:px-6 py-3 rounded-lg sm:rounded-xl font-semibold transition-colors text-sm sm:text-base"
              >
                {isLeaving ? (
                  <div className="flex items-center justify-center">
                    <div className="animate-spin rounded-full h-4 w-4 sm:h-5 sm:w-5 border-t-2 border-b-2 border-gray-600 mr-2"></div>
                    Processing...
                  </div>
                ) : isCreator ? (
                  "Cancel Ride"
                ) : (
                  "Leave Ride"
                )}
              </button>
            )}

            {canComplete && (
              <button
                onClick={handleCompleteRide}
                disabled={isCompleting}
                className="w-full sm:flex-1 bg-gradient-to-r from-secondary-500 to-secondary-600 hover:from-secondary-600 hover:to-secondary-700 disabled:from-gray-400 disabled:to-gray-500 text-white px-4 sm:px-6 py-3 rounded-lg sm:rounded-xl font-semibold transition-all duration-200 transform hover:scale-105 shadow-medium disabled:transform-none disabled:shadow-none text-sm sm:text-base"
              >
                {isCompleting ? (
                  <div className="flex items-center justify-center">
                    <div className="animate-spin rounded-full h-4 w-4 sm:h-5 sm:w-5 border-t-2 border-b-2 border-white mr-2"></div>
                    Completing...
                  </div>
                ) : (
                  <div className="flex items-center justify-center">
                    <CheckCircle className="h-4 w-4 sm:h-5 sm:w-5 mr-2" />
                    Mark as Completed
                  </div>
                )}
              </button>
            )}

            <button
              onClick={() => {
                window.scrollTo({
                  top: 0,
                  behavior: "smooth",
                });
                navigate(-1);
              }}
              className="w-full sm:flex-1 border-2 border-gray-200 hover:border-accent-300 hover:bg-accent-50 text-gray-700 hover:text-accent-700 px-4 sm:px-6 py-3 rounded-lg sm:rounded-xl font-semibold transition-all duration-200 text-sm sm:text-base"
            >
              Go Back
            </button>
          </div>
        </div>
      </div>

      {/* Instructions Card */}
      <div className="bg-blue-50 rounded-2xl sm:rounded-3xl border border-blue-200 p-4 sm:p-6 lg:p-8">
        <div className="flex flex-col sm:flex-row items-start space-y-4 sm:space-y-0 sm:space-x-4">
          <div className="w-10 h-10 sm:w-12 sm:h-12 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 sm:w-6 sm:h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div className="flex-1">
            <h3 className="text-lg sm:text-xl font-bold text-blue-800 mb-2 sm:mb-3">
              Important Instructions
            </h3>
            <div className="text-blue-700 space-y-2 sm:space-y-3 text-sm sm:text-base">
              <p className="leading-relaxed">
                <strong>Transportation Arrangement:</strong> This app helps you find co-passengers. Once your group is formed, you'll need to arrange for transportation offline.
              </p>
              <p className="leading-relaxed">
                <strong>Meeting Point:</strong> We recommend meeting at the starting point 10 minutes before your planned departure time.
              </p>
              <p className="leading-relaxed">
                <strong>Communication:</strong> Use the contact information shared after joining to coordinate with other passengers.
              </p>
            </div>
          </div>
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

export default RideDetail;