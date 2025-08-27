import React, { useEffect, useState } from "react";
import {
  MapContainer,
  Marker,
  Popup,
  useMap,
  useMapEvents,
  Polyline,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Location, RideRequest } from "../../types";
// icons not used directly here
import MapTileLayers from "./MapTileLayers";

// Fix the icon issue with Leaflet in React
const markerIcon = new L.Icon({
  iconUrl: "https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png",
  iconRetinaUrl:
    "https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

const startIcon = new L.Icon({
  iconUrl: "https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png",
  iconRetinaUrl:
    "https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
  className: "start-marker",
});

const endIcon = new L.Icon({
  iconUrl: "https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png",
  iconRetinaUrl:
    "https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
  className: "end-marker",
});

// Component to recenter the map when coordinates change
const RecenterAutomatically = ({
  position,
}: {
  position: [number, number];
}) => {
  const map = useMap();
  useEffect(() => {
    map.setView(position, map.getZoom());
  }, [position, map]);
  return null;
};

// Component to handle map clicks
const MapClickHandler = ({
  onLocationSelect,
  selectingLocation,
}: {
  onLocationSelect?: (location: Location) => void;
  selectingLocation?: "start" | "destination" | null;
}) => {
  useMapEvents({
    click: async (e) => {
      if (onLocationSelect && selectingLocation) {
        try {
          // Use reverse geocoding to get the address
          const response = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${e.latlng.lat}&lon=${e.latlng.lng}`
          );
          const data = await response.json();

          const selectedLocation: Location = {
            coordinates: {
              lat: e.latlng.lat,
              lng: e.latlng.lng,
            },
            address:
              data.display_name ||
              `Location at ${e.latlng.lat.toFixed(4)}, ${e.latlng.lng.toFixed(
                4
              )}`,
          };

          onLocationSelect(selectedLocation);
        } catch (error) {
          console.error("Error getting location address:", error);
          // Fallback to coordinates if geocoding fails
          const selectedLocation: Location = {
            coordinates: {
              lat: e.latlng.lat,
              lng: e.latlng.lng,
            },
            address: `Location at ${e.latlng.lat.toFixed(
              4
            )}, ${e.latlng.lng.toFixed(4)}`,
          };
          onLocationSelect(selectedLocation);
        }
      }
    },
  });
  return null;
};

interface RideMapProps {
  initialPosition?: [number, number];
  rides?: RideRequest[];
  startingPoint?: Location;
  destination?: Location;
  onLocationSelect?: (location: Location) => void;
  selectingLocation?: "start" | "destination" | null;
  height?: string;
  ride?: RideRequest; // for ride detail view
  showRoute?: boolean; // whether to visualize the path between start and destination
}

const RideMap: React.FC<RideMapProps> = ({
  initialPosition = [23.8041, 90.4152], // Default to Dhaka
  rides = [],
  startingPoint,
  destination,
  onLocationSelect,
  selectingLocation,
  height = "400px",
  ride,
  showRoute,
}) => {
  const [currentPosition, setCurrentPosition] =
    useState<[number, number]>(initialPosition);

  // Derive start/destination from either explicit props or from ride (for detail view)
  const derivedStartingPoint = startingPoint || ride?.startingPoint;
  const derivedDestination = destination || ride?.destination;

  // Routed path coordinates (lat, lng)
  const [routeCoordinates, setRouteCoordinates] = useState<
    [number, number][] | null
  >(null);
  const [, setIsRoutingError] = useState<boolean>(false);

  // Fetch routed path via OSRM between start and destination when requested
  useEffect(() => {
    const fetchRoute = async () => {
      if (!showRoute || !derivedStartingPoint || !derivedDestination) {
        setRouteCoordinates(null);
        return;
      }

      try {
        setIsRoutingError(false);
        const startLngLat = `${derivedStartingPoint.coordinates.lng},${derivedStartingPoint.coordinates.lat}`;
        const endLngLat = `${derivedDestination.coordinates.lng},${derivedDestination.coordinates.lat}`;
        const url = `https://router.project-osrm.org/route/v1/driving/${startLngLat};${endLngLat}?overview=full&geometries=geojson`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Routing failed: ${res.status}`);
        const data = await res.json();
        const coords: [number, number][] =
          data?.routes?.[0]?.geometry?.coordinates?.map(
            (c: [number, number]) => [c[1], c[0]]
          ) || [];
        if (coords.length > 0) {
          setRouteCoordinates(coords);
        } else {
          setRouteCoordinates(null);
        }
      } catch (e) {
        console.error("Error fetching route:", e);
        setIsRoutingError(true);
        setRouteCoordinates(null);
      }
    };

    fetchRoute();
  }, [showRoute, derivedStartingPoint?.coordinates, derivedDestination?.coordinates]);

  // Get user's current location on component mount
  useEffect(() => {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setCurrentPosition([
            position.coords.latitude,
            position.coords.longitude,
          ]);
        },
        (error) => {
          console.error("Error getting location:", error);
        }
      );
    }
  }, []);

  // Fit bounds to the route when both points are present
  const FitBoundsOnRoute: React.FC = () => {
    const map = useMap();
    useEffect(() => {
      if (routeCoordinates && routeCoordinates.length > 1) {
        const bounds = L.latLngBounds(routeCoordinates as [number, number][]);
        map.fitBounds(bounds, { padding: [30, 30] });
        return;
      }
      if (derivedStartingPoint && derivedDestination) {
        const bounds = L.latLngBounds(
          [
            derivedStartingPoint.coordinates.lat,
            derivedStartingPoint.coordinates.lng,
          ],
          [
            derivedDestination.coordinates.lat,
            derivedDestination.coordinates.lng,
          ]
        );
        map.fitBounds(bounds, { padding: [30, 30] });
      }
    }, [map, routeCoordinates, derivedStartingPoint, derivedDestination]);
    return null;
  };

  return (
    <div className="relative z-[10] h-[200px] md:h-[400px]" style={{ height }}>
      {selectingLocation && (
        <div className="absolute top-2 left-0 right-0 z-10 mx-auto text-center bg-white bg-opacity-90 py-2 px-4 rounded-md shadow-md text-sm max-w-xs">
          <p className="font-medium">
            Click on the map to select your{" "}
            {selectingLocation === "start" ? "starting point" : "destination"}
          </p>
        </div>
      )}

      <MapContainer
        center={currentPosition}
        zoom={13}
        style={{ height: "100%", width: "100%", borderRadius: "8px" }}
      >
        <MapTileLayers />

        <RecenterAutomatically position={currentPosition} />
        {showRoute && derivedStartingPoint && derivedDestination && (
          <FitBoundsOnRoute />
        )}
        <MapClickHandler
          onLocationSelect={onLocationSelect}
          selectingLocation={selectingLocation}
        />

        {/* Current location marker */}
        <Marker position={currentPosition} icon={markerIcon}>
          <Popup>Your current location</Popup>
        </Marker>

        {/* Starting point marker */}
        {(derivedStartingPoint) && (
          <Marker
            position={[
              derivedStartingPoint.coordinates.lat,
              derivedStartingPoint.coordinates.lng,
            ]}
            icon={startIcon}
          >
            <Popup>
              <strong>Starting Point:</strong>
              <br />
              {derivedStartingPoint.address}
            </Popup>
          </Marker>
        )}

        {/* Destination marker */}
        {(derivedDestination) && (
          <Marker
            position={[
              derivedDestination.coordinates.lat,
              derivedDestination.coordinates.lng,
            ]}
            icon={endIcon}
          >
            <Popup>
              <strong>Destination:</strong>
              <br />
              {derivedDestination.address}
            </Popup>
          </Marker>
        )}

        {/* Highlight path between start and destination */}
        {showRoute && routeCoordinates && routeCoordinates.length > 1 && (
          <Polyline
            positions={routeCoordinates}
            pathOptions={{ color: "#2563eb", weight: 5, opacity: 0.8 }}
          />
        )}

        {/* Render ride markers */}
        {rides.map((ride) => (
          <React.Fragment key={ride.id}>
            <Marker
              position={[
                ride.startingPoint.coordinates.lat,
                ride.startingPoint.coordinates.lng,
              ]}
              icon={startIcon}
            >
              <Popup>
                <strong>Ride #{ride.id.substring(0, 4)}</strong>
                <br />
                <strong>Starting Point:</strong> {ride.startingPoint.address}
                <br />
                <strong>Passengers:</strong> {ride.passengers.length}/
                {ride.totalSeats}
                <br />
                <strong>Status:</strong> {ride.status}
              </Popup>
            </Marker>
            <Marker
              position={[
                ride.destination.coordinates.lat,
                ride.destination.coordinates.lng,
              ]}
              icon={endIcon}
            >
              <Popup>
                <strong>Ride #{ride.id.substring(0, 4)}</strong>
                <br />
                <strong>Destination:</strong> {ride.destination.address}
                <br />
              </Popup>
            </Marker>
          </React.Fragment>
        ))}
      </MapContainer>
    </div>
  );
};

export default RideMap;
