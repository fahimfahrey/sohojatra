export type GeolocationFailureReason =
  | "denied"
  | "unavailable"
  | "timeout"
  | "unsupported";

export function geolocationFailureReason(
  error: GeolocationPositionError,
): GeolocationFailureReason {
  switch (error.code) {
    case error.PERMISSION_DENIED:
      return "denied";
    case error.POSITION_UNAVAILABLE:
      return "unavailable";
    case error.TIMEOUT:
      return "timeout";
    default:
      return "unavailable";
  }
}

export function geolocationFailureMessage(reason: GeolocationFailureReason): string {
  switch (reason) {
    case "denied":
      return "Location access was blocked. You can still pick places on the map or search by name.";
    case "unavailable":
      return "Could not determine your location. Try searching for an address instead.";
    case "timeout":
      return "Location request timed out. Try again or search for an address.";
    case "unsupported":
      return "Your browser does not support location services.";
  }
}

export function requestCurrentPosition(
  options?: PositionOptions,
): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      reject(Object.assign(new Error("unsupported"), { reason: "unsupported" }));
      return;
    }

    navigator.geolocation.getCurrentPosition(resolve, (error) => {
      const reason = geolocationFailureReason(error);
      reject(Object.assign(new Error(reason), { reason, cause: error }));
    }, options);
  });
}
