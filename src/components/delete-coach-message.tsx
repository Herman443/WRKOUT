"use client";

import { deleteCoachMessage } from "@/app/(app)/coach/actions";
import { SubmitButton } from "./submit-button";

export function DeleteCoachMessage({ id }: { id: string }) {
  return (
    <form
      action={deleteCoachMessage}
      className="mt-1 flex justify-end"
      onSubmit={(event) => {
        if (!window.confirm("Delete this message? This cannot be undone. Any plan changes already made will remain.")) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="id" value={id} />
      <SubmitButton variant="quiet" pendingText="Deleting…">Delete</SubmitButton>
    </form>
  );
}
