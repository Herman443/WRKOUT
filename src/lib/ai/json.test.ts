import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parseJsonReply } from "./json";

const schema = z.object({ ideas: z.array(z.object({ title: z.string(), minutes: z.number() })) });

describe("parseJsonReply", () => {
  it("accepts plain JSON", () => {
    const r = parseJsonReply(schema, '{"ideas":[{"title":"Loop","minutes":40}]}');
    expect(r).toEqual({ ok: true, data: { ideas: [{ title: "Loop", minutes: 40 }] } });
  });
  it("unwraps code fences and surrounding prose", () => {
    const r = parseJsonReply(schema, 'Here you go:\n```json\n{ "ideas": [ { "title": "Loop", "minutes": 40 } ] }\n```\nEnjoy.');
    expect(r.ok).toBe(true);
  });
  it("reports schema mismatches with paths", () => {
    const r = parseJsonReply(schema, '{"ideas":[{"title":"Loop","minutes":"forty"}]}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("ideas.0.minutes");
  });
  it("reports missing JSON", () => {
    expect(parseJsonReply(schema, "Sorry, no plan today.")).toEqual({ ok: false, error: "no JSON object found" });
  });
});
