import { z } from "zod";

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  "#39": "'",
};

const sanitizeText = (val: string) =>
  val
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (_, ent: string) => {
      if (ent.startsWith("#x") || ent.startsWith("#X")) {
        const cp = parseInt(ent.slice(2), 16);
        return Number.isFinite(cp) ? String.fromCodePoint(cp) : "";
      }
      if (ent.startsWith("#")) {
        const cp = parseInt(ent.slice(1), 10);
        return Number.isFinite(cp) ? String.fromCodePoint(cp) : "";
      }
      return NAMED_ENTITIES[ent] ?? "";
    })
    .trim();

export const emailSchema = z.string().email().max(255);
export const passwordSchema = z.string().min(8).max(128);
export const nameSchema = z
  .string()
  .min(2)
  .max(100)
  .transform(sanitizeText)
  .pipe(z.string().min(2).max(100));
export const phoneSchema = z
  .string()
  .regex(/^\+?[0-9]{10,15}$/, "Invalid phone number");

const BD_BOUNDS = {
  minLat: 20.5,
  maxLat: 26.7,
  minLng: 88.0,
  maxLng: 92.7,
} as const;

const MAX_RIDE_DISTANCE_KM = 500;

const isInBangladesh = (lat: number, lng: number) =>
  lat >= BD_BOUNDS.minLat &&
  lat <= BD_BOUNDS.maxLat &&
  lng >= BD_BOUNDS.minLng &&
  lng <= BD_BOUNDS.maxLng;

const haversineKm = (
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
) => {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
};

export const locationSchema = z.object({
  coordinates: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  }),
  address: z
    .string()
    .min(3)
    .max(500)
    .transform(sanitizeText)
    .pipe(z.string().min(3).max(500)),
});

export const messageSchema = z
  .string()
  .min(1)
  .max(500)
  .transform(sanitizeText)
  .pipe(z.string().min(1).max(500));

export const vehicleTypeSchema = z.enum([
  "Rickshaw",
  "CNG",
  "Bike",
  "Bus",
  "Car",
  "Uber/Pathao",
]);

export const signInSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

export const signUpSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: nameSchema,
});

export const createRideSchema = z
  .object({
    startingPoint: locationSchema,
    destination: locationSchema,
    totalSeats: z.number().int().min(2).max(5),
    contactPhone: phoneSchema,
    vehicle: vehicleTypeSchema,
  })
  .refine(
    (data) =>
      isInBangladesh(
        data.startingPoint.coordinates.lat,
        data.startingPoint.coordinates.lng,
      ),
    {
      message: "Starting point must be within Bangladesh",
      path: ["startingPoint"],
    },
  )
  .refine(
    (data) =>
      isInBangladesh(
        data.destination.coordinates.lat,
        data.destination.coordinates.lng,
      ),
    {
      message: "Destination must be within Bangladesh",
      path: ["destination"],
    },
  )
  .refine(
    (data) =>
      haversineKm(
        data.startingPoint.coordinates.lat,
        data.startingPoint.coordinates.lng,
        data.destination.coordinates.lat,
        data.destination.coordinates.lng,
      ) <= MAX_RIDE_DISTANCE_KM,
    {
      message: `Ride distance must be under ${MAX_RIDE_DISTANCE_KM}km`,
      path: ["destination"],
    },
  );

export const joinRideSchema = z.object({
  rideId: z.string().uuid(),
  contactPhone: phoneSchema,
});

export const rideIdSchema = z.object({
  rideId: z.string().uuid(),
});

export const searchRidesSchema = z.object({
  startLat: z.number().min(BD_BOUNDS.minLat).max(BD_BOUNDS.maxLat),
  startLng: z.number().min(BD_BOUNDS.minLng).max(BD_BOUNDS.maxLng),
  destLat: z.number().min(BD_BOUNDS.minLat).max(BD_BOUNDS.maxLat),
  destLng: z.number().min(BD_BOUNDS.minLng).max(BD_BOUNDS.maxLng),
  radiusKm: z.number().min(0.1).max(50).default(1),
  vehicle: vehicleTypeSchema.optional().nullable(),
});

export const totpCodeSchema = z
  .string()
  .trim()
  .regex(/^[0-9]{6}$/, "Enter the 6-digit code from your authenticator");

export const recoveryCodeSchema = z
  .string()
  .trim()
  .transform((s) => s.replace(/[\s-]/g, "").toUpperCase())
  .pipe(z.string().regex(/^[A-Z0-9]{8}$/, "Invalid recovery code"));

export type TotpStepUpErrorCode = "2FA_STEPUP_REQUIRED";

export type IdempotencyErrorCode =
  | "IDEMPOTENCY_IN_PROGRESS"
  | "IDEMPOTENCY_INVALID_KEY";

export type ActionErrorCode = TotpStepUpErrorCode | IdempotencyErrorCode;

export type ActionResult<T = void> =
  | { success: true; data?: T }
  | { success: false; error: string; code?: ActionErrorCode };
