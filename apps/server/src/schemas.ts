import { z } from "zod";
import { VIBES, CATEGORIES } from "../../../packages/types/src/index.js";
const iso = z.iso.datetime({ offset: true });
export const preferenceSchema = z
  .object({
    vibes: z
      .array(z.enum(VIBES))
      .min(1)
      .max(7)
      .transform((x) => [...new Set(x)]),
    budget: z.number().int().min(0).max(20000),
    radiusKm: z.number().min(0.2).max(50),
    availableFrom: iso,
    availableUntil: iso,
    veto: z.enum(CATEGORIES).nullable(),
    age: z.number().int().min(18).max(100),
  })
  .strict()
  .refine(
    (p) => Date.parse(p.availableUntil) > Date.parse(p.availableFrom),
    "Проверьте время: конец должен быть позже начала.",
  );
export const settingsSchema = z
  .object({
    title: z.string().trim().min(1).max(70),
    city: z.string().trim().min(1).max(100),
    startsAt: iso,
    durationMinutes: z.number().int().min(60).max(480),
    budget: z.number().int().min(0).max(20000),
    radiusKm: z.number().min(0.2).max(50),
    origin: z
      .object({
        lat: z.number().min(-90).max(90),
        lon: z.number().min(-180).max(180),
      })
      .strict(),
    originName: z.string().trim().min(1).max(80).optional(),
    expectedParticipants: z.number().int().min(2).max(50),
  })
  .strict();
export const createSchema = z
  .object({ settings: settingsSchema, preference: preferenceSchema })
  .strict();
export const answerSchema = z.object({ preference: preferenceSchema }).strict();
export const demoSchema = z
  .object({ displayName: z.string().trim().min(1).max(40) })
  .strict();
