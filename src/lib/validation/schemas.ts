import { z } from "zod";
import DOMPurify from "isomorphic-dompurify";

const sanitizeText = (val: string) =>
  DOMPurify.sanitize(val, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] }).trim();

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

export const createRideSchema = z.object({
  startingPoint: locationSchema,
  destination: locationSchema,
  totalSeats: z.number().int().min(2).max(5),
  contactPhone: phoneSchema,
  vehicle: vehicleTypeSchema,
});

export const joinRideSchema = z.object({
  rideId: z.string().uuid(),
  contactPhone: phoneSchema,
});

export const rideIdSchema = z.object({
  rideId: z.string().uuid(),
});

export const searchRidesSchema = z.object({
  startLat: z.number().min(-90).max(90),
  startLng: z.number().min(-180).max(180),
  destLat: z.number().min(-90).max(90),
  destLng: z.number().min(-180).max(180),
  radiusKm: z.number().min(0.1).max(50).default(1),
  vehicle: vehicleTypeSchema.optional().nullable(),
});

export type ActionResult<T = void> =
  | { success: true; data?: T }
  | { success: false; error: string };
