export type UserType = {
  id: string;
  name: string;
  email: string;
};

export type Coordinates = {
  lat: number;
  lng: number;
};

export type Location = {
  coordinates: Coordinates;
  address: string;
};

export type RideStatus = "open" | "full" | "completed" | "cancelled";

export type VehicleType = "Rickshaw" | "CNG" | "Bike" | "Bus" | "Car" | "Uber/Pathao";

export type RideRequest = {
  id: string;
  creator: string;
  startingPoint: Location;
  destination: Location;
  seatsAvailable: number;
  totalSeats: number;
  passengers: string[];
  status: RideStatus;
  vehicle: VehicleType
  createdAt: string;
  contactPhone?: string;
};

export interface VehicleOption {
  value: VehicleType;
  label: string;
  icon: string;
  description: string;
}

export const VEHICLE_OPTIONS: VehicleOption[] = [
  {
    value: "Rickshaw",
    label: "Rickshaw",
    icon: "🚲",
    description: "Traditional cycle rickshaw - eco-friendly and affordable for short distances",
  },
  {
    value: "CNG",
    label: "CNG Auto-rickshaw",
    icon: "🛺",
    description: "3-wheeler auto-rickshaw - fast and economical for medium distances",
    },
  {
    value: "Bike",
    label: "Motorcycle",
    icon: "🏍️",
    description: "Motorcycle ride - quick for short to medium distances",
  },
  {
    value: "Uber/Pathao",
    label: "Ride Sharing",
    description: "Book a ride via Uber or Pathao app - convenient for all distances",
    icon: "📱",
  }
];


export type Notification = {
  id: string;
  userId: string;
  message: string;
  read: boolean;
  createdAt: string;
  type: "match" | "update" | "join" | "system" | "leave";
  rideId?: string;
};
