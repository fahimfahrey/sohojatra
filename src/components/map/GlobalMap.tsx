import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  useMap,
  useMapEvents,
  LayersControl,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Location } from "../../types";
import { MapPin, Navigation, X } from "lucide-react";
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

// Fix the debounce function to properly handle typed parameters
function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout> | null = null;

  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

// MapEvents component to handle map click events
const MapEvents = ({
  onLocationSelect,
  selectingLocation,
  setLoading,
}: {
  onLocationSelect: (location: Location, type: "start" | "destination") => void;
  selectingLocation: "start" | "destination" | null;
  setLoading: (isLoading: boolean) => void;
}) => {
  // We don't need to store map as a variable if not used
  useMap();

  // Fix the debouncedGeocode function
  const debouncedGeocode = useCallback(
    debounce(
      async (
        lat: number,
        lng: number,
        locationType: "start" | "destination"
      ) => {
        if (!selectingLocation) return;

        try {
          setLoading(true);
          const response = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`
          );
          const data = await response.json();

          const location: Location = {
            coordinates: {
              lat,
              lng,
            },
            address:
              data.display_name ||
              `Location at ${lat.toFixed(4)}, ${lng.toFixed(4)}`,
          };

          onLocationSelect(location, locationType);
        } catch (error) {
          console.error("Error getting location address:", error);
          // Fallback to coordinates if geocoding fails
          const location: Location = {
            coordinates: {
              lat,
              lng,
            },
            address: `Location at ${lat.toFixed(4)}, ${lng.toFixed(4)}`,
          };
          onLocationSelect(location, locationType);
        } finally {
          setLoading(false);
        }
      },
      500
    ),
    [onLocationSelect, selectingLocation, setLoading]
  );

  useMapEvents({
    click: (e) => {
      if (selectingLocation) {
        const { lat, lng } = e.latlng;
        debouncedGeocode(lat, lng, selectingLocation);
      }
    },
  });

  return null;
};

interface LocationSearchInputProps {
  placeholder: string;
  icon: React.ReactNode;
  value: Location | null;
  onChange: (location: Location, type: "start" | "destination") => void;
  onClear: () => void;
  type: "start" | "destination";
  setLoading: (isLoading: boolean) => void;
  mapRef: React.RefObject<L.Map>;
}

const LocationSearchInput: React.FC<LocationSearchInputProps> = ({
  placeholder,
  icon,
  value,
  onChange,
  onClear,
  type,
  setLoading,
  mapRef,
}) => {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<
    Array<{
      display_name: string;
      lat: string;
      lon: string;
      placeholder?: boolean;
    }>
  >([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Search for locations using OpenStreetMap Nominatim geocoding API
  const searchLocations = useCallback(async (searchQuery: string) => {
    console.log("Searching for:", searchQuery);
    if (!searchQuery.trim()) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
          searchQuery
        )}&limit=5&countrycodes=bd&addressdetails=1`
      );

      const data = await response.json();
      console.log("Search results:", data);

      if (data && data.length > 0) {
        setSuggestions(data);
        setShowSuggestions(true);
      } else {
        setSuggestions([
          {
            display_name: `No results found for "${searchQuery}"`,
            lat: "0",
            lon: "0",
            placeholder: true,
          },
        ]);
        setShowSuggestions(true);
      }
    } catch (error) {
      console.error("Error searching for locations:", error);
      setSuggestions([
        {
          display_name: "Error searching for locations",
          lat: "0",
          lon: "0",
          placeholder: true,
        },
      ]);
      setShowSuggestions(true);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Fix the debouncedSearch function with proper dependencies
  const debouncedSearch = useCallback(
    debounce((searchQuery: string) => {
      searchLocations(searchQuery);
    }, 500),
    [searchLocations]
  );

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputValue = e.target.value;
    console.log("Search input changed:", inputValue);
    setQuery(inputValue);
    
    if (inputValue.trim()) {
      debouncedSearch(inputValue);
      setShowSuggestions(true);
    } else {
      setSuggestions([]);
      setShowSuggestions(false);
    }
  };

  const selectLocation = (item: {
    display_name: string;
    lat: string;
    lon: string;
    placeholder?: boolean;
  }) => {
    // Don't select placeholder items
    if (item.placeholder) return;

    const lat = parseFloat(item.lat);
    const lng = parseFloat(item.lon);

    const selectedLocation: Location = {
      coordinates: {
        lat,
        lng,
      },
      address: item.display_name,
    };

    // Update the location in parent component
    onChange(selectedLocation, type);

    // Center map on the selected location with animation and zoom
    if (mapRef.current) {
      // Use flyTo for a smooth animated transition to the selected location
      mapRef.current.flyTo([lat, lng], 16, {
        animate: true,
        duration: 1.5,
      });
    }

    setQuery(item.display_name.split(",")[0].trim());
    setShowSuggestions(false);
  };

  // Show current value in input if available
  useEffect(() => {
    if (value) {
      // Extract name from address for display
      const addressParts = value.address.split(",");
      setQuery(addressParts[0].trim());
    } else {
      setQuery("");
    }
  }, [value]);

  return (
    <div className="relative">
      <div className="flex items-center">
        <div className="absolute left-3 text-gray-500">{icon}</div>
        <input
          type="text"
          className="w-full pl-10 pr-10 py-2 border border-gray-300 rounded-md focus:outline-none "
          placeholder={placeholder}
          value={query}
          onChange={handleInputChange}
          onFocus={() => {
            if (query.trim() && suggestions.length > 0) {
              setShowSuggestions(true);
            }
          }}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
        />
        {value && (
          <button
            className="absolute right-3 text-gray-500 hover:text-gray-700"
            onClick={onClear}
          >
            <X size={16} />
          </button>
        )}
        {isLoading && (
          <div className="absolute right-8 text-gray-500">
            <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-emerald-500"></div>
          </div>
        )}
      </div>

      {showSuggestions && (
        <div className="absolute z-[100] mt-1 w-full bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-auto">
          {isLoading ? (
            <div className="px-4 py-2 text-center text-gray-500">
              <div className="flex items-center justify-center">
                <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-emerald-500"></div>
                <span className="ml-2">Searching...</span>
              </div>
            </div>
          ) : (
            <>
              {suggestions.length === 0 && query !== "" && (
                <div className="px-4 py-2 text-center text-gray-500">
                  No locations found
                </div>
              )}

              {suggestions.map((item, index) => (
                <div
                  key={index}
                  className={`px-4 py-2 hover:bg-gray-100 ${
                    item.placeholder
                      ? "text-gray-500 cursor-default"
                      : "cursor-pointer"
                  }`}
                  onClick={() => !item.placeholder && selectLocation(item)}
                >
                  {item.placeholder ? (
                    <div className="text-center italic">{item.display_name}</div>
                  ) : (
                    <>
                      <div className="font-medium">
                        {item.display_name.split(",")[0]}
                      </div>
                      <div className="text-sm text-gray-500">
                        {item.display_name}
                      </div>
                    </>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
};

interface GlobalMapProps {
  startingPoint: Location | null;
  destination: Location | null;
  onStartingPointChange: (location: Location | null) => void;
  onDestinationChange: (location: Location | null) => void;
  height?: string;
  rides?: Array<{
    id: string;
    startingPoint: Location;
    destination: Location;
    passengers: string[];
    totalSeats: number;
    status: string;
  }>;
}

const GlobalMap: React.FC<GlobalMapProps> = ({
  startingPoint,
  destination,
  onStartingPointChange,
  onDestinationChange,
  height = "400px",
  rides = [],
}) => {
  const [currentPosition, setCurrentPosition] = useState<[number, number]>([
    23.8041, 90.4152,
  ]); // Default to Dhaka

  const [selectingLocation, setSelectingLocation] = useState<
    "start" | "destination" | null
  >(null);
  const [loading, setLoading] = useState(false);
  const mapRef = useRef<L.Map>(null);

  // Helper function to get short location name
  const getShortLocationName = (location: Location | null) => {
    if (!location) return null;
    return location.address.split(',')[0].trim();
  };

  // Get user's current location on component mount
  useEffect(() => {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const newPosition: [number, number] = [
            position.coords.latitude,
            position.coords.longitude,
          ];
          setCurrentPosition(newPosition);

          // If map is available, center it on user's location
          if (mapRef.current) {
            mapRef.current.setView(newPosition, 13);
          }
        },
        (error) => {
          console.error("Error getting location:", error);
        }
      );
    }
  }, []);

  // Handle location selection (from search or map click)
  const handleLocationSelect = useCallback(
    (location: Location, type: "start" | "destination") => {
      if (type === "start") {
        onStartingPointChange(location);
      } else if (type === "destination") {
        onDestinationChange(location);
      }

      // Center map on the selected location with animation
      if (mapRef.current) {
        mapRef.current.setView(
          [location.coordinates.lat, location.coordinates.lng],
          15,
          {
            animate: true,
            duration: 1,
          }
        );
      }

      // Reset selecting state
      setSelectingLocation(null);
    },
    [onStartingPointChange, onDestinationChange]
  );

  // Handle marker drag end events
  const handleMarkerDragEnd = async (
    latlng: L.LatLng,
    type: "start" | "destination"
  ) => {
    setLoading(true);
    try {
      // Use reverse geocoding to get the address
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latlng.lat}&lon=${latlng.lng}`
      );
      const data = await response.json();

      const location: Location = {
        coordinates: {
          lat: latlng.lat,
          lng: latlng.lng,
        },
        address:
          data.display_name ||
          `Location at ${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)}`,
      };

      if (type === "start") {
        onStartingPointChange(location);
      } else {
        onDestinationChange(location);
      }

      // Center map on new position with animation
      if (mapRef.current) {
        mapRef.current.setView(
          [latlng.lat, latlng.lng],
          mapRef.current.getZoom(),
          {
            animate: true,
            duration: 1,
          }
        );
      }
    } catch (error) {
      console.error("Error getting location address:", error);
      // Fallback to coordinates if geocoding fails
      const location: Location = {
        coordinates: {
          lat: latlng.lat,
          lng: latlng.lng,
        },
        address: `Location at ${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(
          4
        )}`,
      };

      if (type === "start") {
        onStartingPointChange(location);
      } else {
        onDestinationChange(location);
      }
    } finally {
      setLoading(false);
    }
  };

  // Get center position based on available markers
  const getCenterPosition = () => {
    if (startingPoint) {
      return [startingPoint.coordinates.lat, startingPoint.coordinates.lng] as [
        number,
        number
      ];
    } else if (destination) {
      return [destination.coordinates.lat, destination.coordinates.lng] as [
        number,
        number
      ];
    }
    return currentPosition;
  };

  // Function to handle getting current location
  const handleGetCurrentLocation = () => {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const newPosition: [number, number] = [
            position.coords.latitude,
            position.coords.longitude,
          ];
          setCurrentPosition(newPosition);

          // Center map on user's location
          if (mapRef.current) {
            mapRef.current.setView(newPosition, 15, {
              animate: true,
              duration: 1,
            });
          }
        },
        (error) => {
          console.error("Error getting location:", error);
        }
      );
    }
  };

  return (
    <div>
      {/* Full Screen Loader */}
      {loading && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-[9999] flex items-center justify-center">
          <div className="bg-white rounded-2xl p-8 shadow-2xl flex flex-col items-center space-y-4">
              <div className="relative">
                <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-orange-500"></div>
                <div className="absolute inset-0 rounded-full border-4 border-orange-500 opacity-30"></div>
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="h-8 w-8 bg-orange-500 rounded-full animate-pulse"></div>
                </div>
              </div>
            <div className="text-center">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                Getting Location Details
              </h3>
              <p className="text-gray-600">
                Please wait while we fetch the address...
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="mb-6 space-y-4 p-2">
        <LocationSearchInput
          placeholder="Search for starting point..."
          icon={<MapPin size={18} />}
          value={startingPoint}
          onChange={handleLocationSelect}
          onClear={() => onStartingPointChange(null)}
          type="start"
          setLoading={setLoading}
          mapRef={mapRef}
        />

        <LocationSearchInput
          placeholder="Search for destination..."
          icon={<Navigation size={18} />}
          value={destination}
          onChange={handleLocationSelect}
          onClear={() => onDestinationChange(null)}
          type="destination"
          setLoading={setLoading}
          mapRef={mapRef}
        />

        <div className="flex space-x-2">
          <button
            type="button"
            className={`btn-modern w-1/2 max-md:w-full py-4 px-6 bg-gradient-to-r from-accent-400 to-accent-500 hover:from-accent-500 hover:to-accent-600 text-white font-semibold rounded-2xl transition-all duration-300 transform shadow-medium hover:shadow-large disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none flex items-center justify-center ${
              selectingLocation === "start"
                ? "bg-emerald-600 text-white"
                : "bg-emerald-900 text-white"
            }`}
            onClick={() =>
              setSelectingLocation(
                selectingLocation === "start" ? null : "start"
              )
            }
            disabled={loading}
          >
            {selectingLocation === "start" 
              ? "Cancel" 
              : startingPoint 
                ? getShortLocationName(startingPoint)
                : "Starting point"
            }
          </button>

          <button
            type="button"
            className={`btn-modern w-1/2 max-md:w-full py-4 px-6 bg-gradient-to-r from-accent-400 to-accent-500 hover:from-accent-500 hover:to-accent-600 text-white font-semibold rounded-2xl transition-all duration-300 transform shadow-medium hover:shadow-large disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none flex items-center justify-center ${
              selectingLocation === "destination"
                ? "bg-emerald-600 text-white"
                : "bg-black text-white"
            }`}
            onClick={() =>
              setSelectingLocation(
                selectingLocation === "destination" ? null : "destination"
              )
            }
            disabled={loading}
          >
            {selectingLocation === "destination"
              ? "Cancel"
              : destination
                ? getShortLocationName(destination)
                : "Select destination"
            }
          </button>
        </div>
      </div>

      <div className="relative z-[10] h-[200px]">
        <MapContainer
          center={getCenterPosition()}
          zoom={13}
          style={{ height: "100%", width: "100%", borderRadius: "8px" }}
          whenReady={(e: L.LeafletEvent) => {
            if ('target' in e && e.target instanceof L.Map) {
              mapRef.current = e.target;
            }
          }}
        >
          <MapTileLayers />

          <MapEvents
            onLocationSelect={handleLocationSelect}
            selectingLocation={selectingLocation}
            setLoading={setLoading}
          />
          {/* Current location marker */}
          <Marker position={currentPosition} icon={markerIcon}>
            <Popup>Your current location</Popup>
          </Marker>

          {/* Starting point marker (draggable) */}
          {startingPoint && (
            <Marker
              draggable={true}
              position={[
                startingPoint.coordinates.lat,
                startingPoint.coordinates.lng,
              ]}
              icon={startIcon}
              eventHandlers={{
                dragend: (e) => {
                  const marker = e.target;
                  const position = marker.getLatLng();
                  handleMarkerDragEnd(position, "start");
                },
              }}
            >
              <Popup>
                <strong>Starting Point:</strong>
                <br />
                {startingPoint.address}
              </Popup>
            </Marker>
          )}

          {/* Destination marker (draggable) */}
          {destination && (
            <Marker
              draggable={true}
              position={[
                destination.coordinates.lat,
                destination.coordinates.lng,
              ]}
              icon={endIcon}
              eventHandlers={{
                dragend: (e) => {
                  const marker = e.target;
                  const position = marker.getLatLng();
                  handleMarkerDragEnd(position, "destination");
                },
              }}
            >
              <Popup>
                <strong>Destination:</strong>
                <br />
                {destination.address}
              </Popup>
            </Marker>
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

        {/* Map controls */}
        <div className="absolute bottom-4 right-4 flex flex-col space-y-2">
          <button
            className="bg-white rounded-full p-2 shadow-md hover:bg-gray-100 transition-colors disabled:opacity-50"
            onClick={handleGetCurrentLocation}
            title="Get your current location"
            disabled={loading}
          >
            <Navigation className="h-5 w-5 text-gray-700" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default GlobalMap;
