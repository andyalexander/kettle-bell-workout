import type { Profile, RoutineSummary } from "../api";
import { CircleButton } from "../ui/CircleButton";
import { Page } from "../ui/Page";
import { QuietButton } from "../ui/QuietButton";
import { RoutineDetails } from "./RoutineDetails";

interface RoutineListProps {
  readonly profile: Profile;
  /** The routines on this profile's list, and no one else's (ADR-0005). */
  readonly routines: readonly RoutineSummary[];
  /** The routine whose workout is on its way; every Start waits until it lands. */
  readonly startingRoutineId: number | null;
  /** Why the last call failed — a Start, or the reload after a workout. */
  readonly problem: string | null;
  readonly onChoose: (routine: RoutineSummary) => void;
  readonly onEdit: (routine: RoutineSummary) => void;
  readonly onNew: () => void;
  readonly onBack: () => void;
}

/**
 * This profile's routine list (#19, ADR-0005). No history and no personal
 * weights here: a profile's load first appears at prep. Start is the one big
 * circle; editing is rare, so its ways in stay small (#48).
 */
export function RoutineList({
  profile,
  routines,
  startingRoutineId,
  problem,
  onChoose,
  onEdit,
  onNew,
  onBack,
}: RoutineListProps) {
  const starting = startingRoutineId !== null;
  return (
    <Page title={profile.name} onBack={onBack}>
      {problem && (
        <p
          role="alert"
          className="text-center text-[clamp(18px,4vmin,42px)] font-semibold text-red-300"
        >
          {problem}
        </p>
      )}
      {routines.length === 0 ? (
        <p className="text-[clamp(20px,4.6vmin,50px)] opacity-70">No routines yet.</p>
      ) : (
        <ul className="flex w-full max-w-[1100px] flex-col gap-[4vmin]">
          {routines.map((routine) => (
            // Phone: details full width, then Edit and Start sharing a row at
            // opposite ends. Wider: details and Edit left, Start centred right.
            <li
              key={routine.id}
              className="grid grid-cols-[1fr_auto] gap-x-[4vmin] gap-y-[3vmin] rounded-[4vmin] bg-white/[0.07] p-[4vmin]"
            >
              <RoutineDetails routine={routine} className="col-span-2 sm:col-span-1" />
              <QuietButton
                className="col-start-1 self-center justify-self-start sm:self-start"
                aria-label={`Edit ${routine.name}`}
                disabled={starting}
                onClick={() => onEdit(routine)}
              >
                Edit
              </QuietButton>
              <CircleButton
                className="col-start-2 row-start-2 self-center sm:row-span-2 sm:row-start-1"
                aria-label={`Start ${routine.name}`}
                disabled={starting}
                onClick={() => onChoose(routine)}
              >
                {startingRoutineId === routine.id ? "…" : "Start"}
              </CircleButton>
            </li>
          ))}
        </ul>
      )}
      {/* Rare, so small and at the very bottom, out of reach of a stray tap. */}
      <QuietButton className="mt-auto" disabled={starting} onClick={onNew}>
        ＋ New routine
      </QuietButton>
    </Page>
  );
}
