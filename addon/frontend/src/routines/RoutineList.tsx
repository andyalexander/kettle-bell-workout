import type { Profile, RoutineSummary } from "../api";
import { CircleButton } from "../ui/CircleButton";
import { Page } from "../ui/Page";
import { routineLine } from "./format";

interface RoutineListProps {
  readonly profile: Profile;
  readonly routines: readonly RoutineSummary[];
  /** The routine whose workout is on its way; every Start waits until it lands. */
  readonly starting: number | null;
  /** Why the last Start failed, if it did. */
  readonly notice: string | null;
  readonly onChoose: (routine: RoutineSummary) => void;
  readonly onBack: () => void;
}

/**
 * Every routine, the same for everyone (#19). No history and no personal
 * weights here: a profile's load first appears at prep.
 */
export function RoutineList({
  profile,
  routines,
  starting,
  notice,
  onChoose,
  onBack,
}: RoutineListProps) {
  return (
    <Page title={profile.name} onBack={onBack}>
      {notice && (
        <p
          role="alert"
          className="text-center text-[clamp(18px,4vmin,42px)] font-semibold text-red-300"
        >
          {notice}
        </p>
      )}
      {routines.length === 0 ? (
        <p className="text-[clamp(20px,4.6vmin,50px)] opacity-70">No routines yet.</p>
      ) : (
        <ul className="flex w-full max-w-[1100px] flex-col gap-[4vmin]">
          {routines.map((routine) => (
            <li
              key={routine.id}
              className="flex flex-col gap-[4vmin] rounded-[4vmin] bg-white/[0.07] p-[4vmin] sm:flex-row sm:items-center"
            >
              {/* Stacked on a phone, so the line never wraps mid-way beside Start. */}
              <div className="min-w-0 flex-1">
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
              <CircleButton
                className="self-end sm:self-auto"
                aria-label={`Start ${routine.name}`}
                disabled={starting !== null}
                onClick={() => onChoose(routine)}
              >
                {starting === routine.id ? "…" : "Start"}
              </CircleButton>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}
