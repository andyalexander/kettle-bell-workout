import type { Profile, RoutineSummary } from "../api";
import { CircleButton } from "../ui/CircleButton";
import { Page } from "../ui/Page";
import { routineLine } from "./format";

interface RoutineListProps {
  readonly profile: Profile;
  readonly routines: readonly RoutineSummary[];
  /** The routine whose workout is on its way; every Start waits until it lands. */
  readonly startingRoutineId: number | null;
  /** Why the last call failed — a Start, or the reload after a workout. */
  readonly problem: string | null;
  readonly onChoose: (routine: RoutineSummary) => void;
  readonly onBack: () => void;
  /** PROTOTYPE (#48): the ways into the routine editor. */
  readonly onEdit: (routine: RoutineSummary) => void;
  readonly onNew: () => void;
}

/** A rare action: a small, quiet pill, never competing with Start (#48). */
const QUIET =
  "min-h-[48px] rounded-full px-[5vmin] py-[2vmin] text-[clamp(14px,3vmin,24px)] font-bold tracking-[0.06em] uppercase opacity-60 ring-2 ring-white/30 ring-inset active:scale-95 disabled:opacity-25";

/**
 * Every routine, the same for everyone (#19). No history and no personal
 * weights here: a profile's load first appears at prep.
 */
export function RoutineList({
  profile,
  routines,
  startingRoutineId,
  problem,
  onChoose,
  onBack,
  onEdit,
  onNew,
}: RoutineListProps) {
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
              <div className="col-span-2 min-w-0 sm:col-span-1">
                <h2 className="text-[clamp(28px,7vmin,84px)] leading-none font-extrabold tracking-[-0.02em] break-words">
                  {routine.name}
                </h2>
                <p className="mt-[1.5vmin] text-[clamp(20px,4.6vmin,50px)] font-bold tabular-nums">
                  {routineLine(routine)}
                </p>
                <p className="mt-[1vmin] text-[clamp(16px,3.4vmin,36px)] opacity-70">
                  {routine.exercise_names.join(" · ")}
                </p>
              </div>
              <button
                type="button"
                className={`${QUIET} col-start-1 self-center justify-self-start sm:self-start`}
                aria-label={`Edit ${routine.name}`}
                disabled={startingRoutineId !== null}
                onClick={() => onEdit(routine)}
              >
                Edit
              </button>
              <CircleButton
                className="col-start-2 row-start-2 self-center sm:row-span-2 sm:row-start-1"
                aria-label={`Start ${routine.name}`}
                disabled={startingRoutineId !== null}
                onClick={() => onChoose(routine)}
              >
                {startingRoutineId === routine.id ? "…" : "Start"}
              </CircleButton>
            </li>
          ))}
        </ul>
      )}
      {/* Rare, so small and at the very bottom, out of reach of a stray tap. */}
      <button type="button" onClick={onNew} className={`${QUIET} mt-auto`}>
        ＋ New routine
      </button>
    </Page>
  );
}
