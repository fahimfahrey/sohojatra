import { locationConsent, requestLocationConsent } from "@/lib/consent";

export type GeolocationFailureReason =
  | "denied"
  | "unavailable"
  | "timeout"
  | "unsupported"
  | "consent_required";

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
    case "consent_required":
      return "Please grant location consent to use this feature.";
  }
}

export interface RequestPositionOptions extends PositionOptions {
  /**
   * If true, skip the in-app consent gate. Callers should only set this after
   * presenting their own consent UI and storing the decision via
   * locationConsent.set(). Default: false.
   */
  bypassConsent?: boolean;
}

export async function requestCurrentPosition(
  options?: RequestPositionOptions,
): Promise<GeolocationPosition> {
  if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
    throw Object.assign(new Error("unsupported"), { reason: "unsupported" });
  }

  if (!options?.bypassConsent && !locationConsent.granted()) {
    const decision = await requestLocationConsent();
    if (decision !== "granted") {
      throw Object.assign(new Error("consent_required"), {
        reason: "consent_required",
      });
    }
  }

  const positionOptions: PositionOptions = options
    ? {
        enableHighAccuracy: options.enableHighAccuracy,
        maximumAge: options.maximumAge,
        timeout: options.timeout,
      }
    : {};
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, (error) => {
      const reason = geolocationFailureReason(error);
      reject(Object.assign(new Error(reason), { reason, cause: error }));
    }, positionOptions);
  });
}
