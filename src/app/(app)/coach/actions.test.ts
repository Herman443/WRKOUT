import { beforeEach, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ db: { delete: vi.fn() } }));
vi.mock("@/lib/auth", () => ({ requireSession: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { db } from "@/db";
import { coachMessages } from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { deleteCoachMessage } from "./actions";

const where = vi.fn();
const id = "3f0c28bf-2384-4b72-bb52-ea63962d1074";

function messageForm(value = id) {
  const form = new FormData();
  form.set("id", value);
  return form;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(db.delete).mockReturnValue({ where } as unknown as ReturnType<typeof db.delete>);
});

it("deletes only the selected message and refreshes the conversation", async () => {
  await deleteCoachMessage(messageForm());
  expect(requireSession).toHaveBeenCalledOnce();
  expect(db.delete).toHaveBeenCalledWith(coachMessages);
  expect(where).toHaveBeenCalledWith(eq(coachMessages.id, id));
  expect(revalidatePath).toHaveBeenCalledWith("/coach");
});

it("requires authentication before deleting", async () => {
  vi.mocked(requireSession).mockRejectedValue(new Error("Unauthorized"));
  await expect(deleteCoachMessage(messageForm())).rejects.toThrow("Unauthorized");
  expect(db.delete).not.toHaveBeenCalled();
});

it("rejects an invalid message id without deleting", async () => {
  await expect(deleteCoachMessage(messageForm("invalid"))).rejects.toThrow();
  expect(db.delete).not.toHaveBeenCalled();
});

it("does not report a refresh when deletion fails", async () => {
  where.mockRejectedValue(new Error("Database unavailable"));
  await expect(deleteCoachMessage(messageForm())).rejects.toThrow("Database unavailable");
  expect(revalidatePath).not.toHaveBeenCalled();
});
