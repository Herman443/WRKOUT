"use client";

import { useState } from "react";
import { GOAL_DISTANCES } from "@/lib/forms";
import { Field, inputClass } from "./ui";

export function GoalFields({ minDate }: { minDate: string }) {
  const [sport, setSport] = useState<"run" | "bike">("run");
  const [distance, setDistance] = useState<string>("21097");
  return (
    <fieldset className="space-y-4">
      <legend className="text-lg font-semibold tracking-tight">Your goal</legend>
      <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Sport">
        {(["run", "bike"] as const).map((s) => (
          <label key={s}>
            <input
              type="radio"
              name="sport"
              value={s}
              checked={sport === s}
              onChange={() => {
                setSport(s);
                setDistance(String(GOAL_DISTANCES[s][s === "run" ? 2 : 0].value));
              }}
              className="peer sr-only"
            />
            <span className="block rounded-xl border border-line bg-paper py-3 text-center peer-checked:border-ink peer-checked:bg-ink peer-checked:text-fog">
              {s === "run" ? "Running" : "Cycling"}
            </span>
          </label>
        ))}
      </div>
      <Field label="Event">
        <input name="goalName" placeholder={sport === "run" ? "Oslo Half Marathon" : "Styrkeprøven"} className={inputClass} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date">
          <input type="date" name="eventDate" required min={minDate} className={inputClass} />
        </Field>
        <Field label="Distance">
          <select name="distance" value={distance} onChange={(e) => setDistance(e.target.value)} className={inputClass}>
            {GOAL_DISTANCES[sport].map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
            <option value="custom">Other distance</option>
          </select>
        </Field>
        {distance === "custom" && (
          <Field label="Distance in km">
            <input name="customKm" inputMode="decimal" required className={inputClass} />
          </Field>
        )}
        <Field label="Target time" hint="Optional, h:mm:ss">
          <input name="targetTime" placeholder="1:45:00" className={inputClass} />
        </Field>
      </div>
      <Field label="About the course" hint="Optional: hills, surface, conditions">
        <input name="goalNotes" className={inputClass} />
      </Field>
    </fieldset>
  );
}
