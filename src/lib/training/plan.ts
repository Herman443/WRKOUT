import { z } from "zod";

export const phaseSchema = z.enum(["base", "build", "peak", "taper", "race", "recovery"]);
export type Phase = z.infer<typeof phaseSchema>;

export const weekOutlineSchema = z.object({
  index: z.number().int().describe("0-based week number"),
  startDate: z.string().describe("Monday of the week, YYYY-MM-DD"),
  phase: phaseSchema,
  isDeload: z.boolean().describe("Planned recovery/absorption week with clearly reduced load"),
  targetHours: z.number().describe("Total planned training hours across all sports"),
  targetRunKm: z.number().nullable(),
  targetBikeHours: z.number().nullable(),
  focus: z.string().describe("One line: what this week is for"),
  keySessions: z.array(z.string()).describe("Short descriptions of the week's key sessions"),
});
export type WeekOutline = z.infer<typeof weekOutlineSchema>;

export const macroPlanSchema = z.object({
  summary: z.string().describe("2-4 sentences: overall approach and why it suits this athlete and race"),
  phases: z.array(
    z.object({
      phase: phaseSchema,
      startDate: z.string(),
      endDate: z.string(),
      goal: z.string(),
    }),
  ),
  weeks: z.array(weekOutlineSchema),
  predictedFinishSec: z.number().nullable().describe("Realistic race-day prediction if the plan is followed"),
});
export type MacroPlan = z.infer<typeof macroPlanSchema>;
