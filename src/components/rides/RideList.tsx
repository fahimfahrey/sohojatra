import React, { useState, useEffect } from "react";
import { RideRequest } from "../../types";
import RideCard from "./RideCard";
import { useRide } from "../../contexts/RideContext";
import { toast } from "react-hot-toast";
import { useNavigate } from "react-router-dom";
import { useNotification } from "../../contexts/NotificationContext";
import PhoneNumberModal from "./PhoneNumberModal";

interface RideListProps {
  rides: RideRequest[];
  showActions?: boolean;
  emptyMessage?: string;
  onJoin?: (rideId: string) => void;
  onCancel?: (rideId: string) => void;
  onComplete?: (rideId: string) => void;
}

const RideList: React.FC<RideListProps> = ({
  rides,
  showActions = false,
  emptyMessage = "No rides available",
  onJoin,
  onCancel,
  onComplete,
}) => {
  const {
    joinRideRequest,
    cancelRideRequest,
    completeRideRequest,
    syncRideStatus,
  } = useRide();
  const navigate = useNavigate();
  const { addNotification } = useNotification();
  const [showPhoneModal, setShowPhoneModal] = useState(false);
  const [selectedRideId, setSelectedRideId] = useState<string | null>(null);

  // Sort rides by createdAt in descending order (newest first)
  const sortedRides = [...rides].sort((a, b) => {
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  // Track rides in state just for logging
  useEffect(() => {
    if (process.env.NODE_ENV === "development") {
      console.log(
        "RideList: Current ride IDs:",
        sortedRides.map((r) => r.id).join(", ")
      );
    }
  }, [sortedRides]);

  const handleJoinClick = async (rideId: string) => {
    // Sync ride status before joining
    await syncRideStatus(rideId);

    // Check if ride is still joinable after sync
    const updatedRide = rides.find((r) => r.id === rideId);
    if (
      !updatedRide ||
      updatedRide.status !== "open" ||
      updatedRide.seatsAvailable <= 0
    ) {
      toast.error("This ride is no longer available");
      return;
    }

    setSelectedRideId(rideId);
    setShowPhoneModal(true);
  };

  const handlePhoneSubmit = async (phoneNumber: string) => {
    if (!selectedRideId) return;

    setShowPhoneModal(false);
    try {
      // Sync ride status before joining
      await syncRideStatus(selectedRideId);

      // Re-check if ride is still joinable
      const selectedRide = rides.find((r) => r.id === selectedRideId);
      if (
        !selectedRide ||
        selectedRide.status !== "open" ||
        selectedRide.seatsAvailable <= 0
      ) {
        toast.error("This ride is no longer available");
        return;
      }

      await joinRideRequest(selectedRideId, phoneNumber);
      const ride = rides.find((r) => r.id === selectedRideId);
      if (ride) {
        addNotification(
          `You have joined a ride to ${ride.destination.address}.`,
          "join",
          selectedRideId
        );
      }
      toast.success("Successfully joined the ride");

      // Redirect to the ride details page
      navigate(`/rides/${selectedRideId}`);
    } catch (error) {
      toast.error("Failed to join ride");
      console.error(error);
    } finally {
      setSelectedRideId(null);
    }
  };

  const handleCancelRide = async (rideId: string) => {
    try {
      // Sync ride status before cancelling
      await syncRideStatus(rideId);

      // Check if ride is still cancellable after sync
      const updatedRide = rides.find((r) => r.id === rideId);
      if (
        !updatedRide ||
        updatedRide.status === "completed" ||
        updatedRide.status === "cancelled"
      ) {
        toast.error(`Ride is already ${updatedRide?.status}`);
        return;
      }

      await cancelRideRequest(rideId);
      const ride = rides.find((r) => r.id === rideId);
      if (ride) {
        addNotification(
          `You have cancelled your ride to ${ride.destination.address}.`,
          "update",
          rideId
        );
      }
      toast.success("Ride cancelled successfully");
    } catch (error) {
      toast.error(
        "Failed to cancel ride. The ride might have already been completed."
      );
      console.error(error);
    }
  };

  const handleCompleteRide = async (rideId: string) => {
    try {
      // Sync ride status before completing
      await syncRideStatus(rideId);

      // Check if ride is still completable after sync
      const updatedRide = rides.find((r) => r.id === rideId);
      if (
        !updatedRide ||
        updatedRide.status === "completed" ||
        updatedRide.status === "cancelled"
      ) {
        toast.error(`Ride is already ${updatedRide?.status}`);
        return;
      }

      await completeRideRequest(rideId);
      const ride = rides.find((r) => r.id === rideId);
      if (ride) {
        addNotification(
          `Your ride to ${ride.destination.address} has been completed.`,
          "update",
          rideId
        );
      }
      toast.success("Ride completed successfully");
    } catch (error) {
      toast.error("Failed to complete ride");
      console.error(error);
    }
  };

  if (sortedRides.length === 0) {
    return (
      <div className="bg-white rounded-2xl p-8 sm:p-12 lg:p-16 text-center shadow-soft border border-gray-100">
        <div className="w-16 h-16 sm:w-20 sm:h-20 lg:w-24 lg:h-24 bg-gradient-to-br from-gray-200 to-gray-300 rounded-2xl flex items-center justify-center mx-auto mb-4 sm:mb-6 lg:mb-8">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-8 w-8 sm:h-10 sm:w-10 lg:h-12 lg:w-12 text-gray-500"
          >
            <path d="M3 6h18l-2 13H5L3 6Z"></path>
            <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </div>
        <h3 className="text-xl sm:text-2xl lg:text-3xl font-bold text-gray-900 mb-2 sm:mb-4">
          {emptyMessage}
        </h3>
        <p className="text-gray-600 text-base sm:text-lg max-w-md mx-auto">
          Check back later or create a new ride to get started!
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-6 lg:gap-8">
      {sortedRides.map((ride) => (
        <div key={ride.id} className="w-full">
          <RideCard
            ride={ride}
            onJoin={showActions ? onJoin : undefined}
            onCancel={showActions ? onCancel : undefined}
            onComplete={showActions ? onComplete : undefined}
          />
        </div>
      ))}
    </div>
  );
};

export default RideList;
