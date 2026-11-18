import { beforeEach, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ db: { select: () => ({ from: () => ({ where: async () => [] }) }) } }));
vi.mock("./env", () => ({ env: {} }));
vi.mock("./ingest", () => ({
  getKv: vi.fn(), setKv: vi.fn(), logUnsyncedTreadmillSessions: vi.fn(),
}));
vi.mock("./jobs", () => ({ enqueue: vi.fn(), hasOpenJob: vi.fn(), kickWorker: vi.fn() }));
vi.mock("./plan-store", () => ({ getActivePlan: vi.fn(), getWeeks: vi.fn(), workoutsBetween: vi.fn() }));
vi.mock("./push", () => ({ sendPush: vi.fn() }));

import { getKv, setKv } from "./ingest";
import { getActivePlan, getWeeks, workoutsBetween } from "./plan-store";
import { sendPush } from "./push";
import { tick } from "./tick";

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getActivePlan).mockResolvedValue({ plan: { id: "plan", status: "active" } } as Awaited<ReturnType<typeof getActivePlan>>);
  vi.mocked(getWeeks).mockResolvedValue([]);
  vi.mocked(workoutsBetween).mockResolvedValue([
    { id: "run", title: "Easy run", status: "planned", plannedDurationSec: 1800, purpose: "Build endurance." },
  ] as Awaited<ReturnType<typeof workoutsBetween>>);
});

it.each(["2026-11-18T06:00:00Z", "2026-11-18T17:59:00Z", "2026-11-18T19:00:00Z"])("does not send the workout reminder outside 19:00 local: %s", async (time) => {
  await tick(new Date(time));
  expect(sendPush).not.toHaveBeenCalled();
});

it.each([
  ["2026-11-18T18:00:00Z", "2026-11-19"],
  ["2026-07-31T17:00:00Z", "2026-08-01"],
  ["2026-12-31T18:00:00Z", "2027-01-01"],
])("sends tomorrow's workout at 19:00 local: %s", async (time, tomorrow) => {
  await tick(new Date(time));
  expect(workoutsBetween).toHaveBeenCalledWith("plan", tomorrow, tomorrow);
  expect(sendPush).toHaveBeenCalledWith(expect.objectContaining({ title: "Tomorrow: Easy run", url: "/workout/run" }));
});

it("does not repeat the reminder on later scheduler ticks", async () => {
  vi.mocked(getKv).mockResolvedValue("2026-11-18");
  await tick(new Date("2026-11-18T18:15:00Z"));
  expect(sendPush).not.toHaveBeenCalled();
});

it("describes tomorrow's rest day when no workouts are planned", async () => {
  vi.mocked(workoutsBetween).mockResolvedValue([]);
  await tick(new Date("2026-11-18T18:00:00Z"));
  expect(sendPush).toHaveBeenCalledWith(expect.objectContaining({ title: "Rest day", body: "Nothing planned tomorrow. Recover well." }));
  expect(setKv).toHaveBeenCalledWith("evening_push_date", "2026-11-18");
});
