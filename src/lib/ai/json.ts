import type { z } from "zod";

/** Lenient JSON extraction (code fences, surrounding prose) followed by strict schema validation. */
export function parseJsonReply<S extends z.ZodType>(
  schema: S,
  text: string,
): { ok: true; data: z.infer<S> } | { ok: false; error: string } {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end <= start) return { ok: false, error: "no JSON object found" };
  let value: unknown;
  try {
    value = JSON.parse(body.slice(start, end + 1));
  } catch (e) {
    return { ok: false, error: `invalid JSON (${e instanceof Error ? e.message : String(e)})` };
  }
  const result = schema.safeParse(value);
  if (result.success) return { ok: true, data: result.data };
  const issues = result.error.issues.slice(0, 8).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
  return { ok: false, error: `schema mismatch: ${issues.join("; ")}` };
}
