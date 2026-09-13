import { useState } from "react";

import type { Profile, RoutineSummary } from "../api";
import { addToList, describeFailure } from "../api";
import { CircleButton } from "../ui/CircleButton";
import { Page } from "../ui/Page";
import { QuietButton } from "../ui/QuietButton";
import { RoutineDetails } from "./RoutineDetails";

interface RoutineLibraryProps {
  readonly profile: Profile;
  /** Every routine in the library that isn't on this profile's list yet. */
  readonly routines: readonly RoutineSummary[];
  /** The routine is on the list; resolves once the lists have reloaded. */
  readonly onAdded: () => Promise<void>;
  /** ＋ Create new: the editor, starting from nothing. */
  readonly onCreate: () => void;
  readonly onBack: () => void;
}

/**
 * ＋ New routine (ADR-0005): add a routine from the library to this profile's
 * list, or create one from nothing. Add is each routine's one circle; creating
 * stays small at the bottom, as ＋ New routine does on the list.
 */
export function RoutineLibrary({ profile, routines, onAdded, onCreate, onBack }: RoutineLibraryProps) {
  const [addingId, setAddingId] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const handleAdd = async (routine: RoutineSummary) => {
    setAddingId(routine.id);
    setProblem(null);
    try {
      await addToList(profile.id, routine.id);
      await onAdded();
    } catch (error) {
      setProblem(describeFailure(error));
      setAddingId(null);
    }
  };

  const adding = addingId !== null;
  return (
    <Page title="New routine" onBack={onBack}>
      {problem && (
        <p
          role="alert"
          className="text-center text-[clamp(18px,4vmin,42px)] font-semibold text-red-300"
        >
          {problem}
        </p>
      )}
      {routines.length === 0 ? (
        <p className="text-[clamp(20px,4.6vmin,50px)] opacity-70">Every routine is on your list.</p>
      ) : (
        <ul className="flex w-full max-w-[1100px] flex-col gap-[4vmin]">
          {routines.map((routine) => (
            // Phone: details full width, Add beneath at the right. Wider: side by side.
            <li
              key={routine.id}
              className="grid grid-cols-[1fr_auto] gap-x-[4vmin] gap-y-[3vmin] rounded-[4vmin] bg-white/[0.07] p-[4vmin]"
            >
              <RoutineDetails routine={routine} className="col-span-2 sm:col-span-1" />
              <CircleButton
                className="col-start-2 self-center sm:row-start-1"
                aria-label={`Add ${routine.name}`}
                disabled={adding}
                onClick={() => void handleAdd(routine)}
              >
                {addingId === routine.id ? "…" : "Add"}
              </CircleButton>
            </li>
          ))}
        </ul>
      )}
      <QuietButton className="mt-auto" disabled={adding} onClick={onCreate}>
        ＋ Create new
      </QuietButton>
    </Page>
  );
}
