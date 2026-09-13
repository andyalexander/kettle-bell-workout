import type { RoutineSummary } from "../api";
import { routineLine } from "./format";

interface RoutineDetailsProps {
  readonly routine: RoutineSummary;
  readonly className?: string;
}

/** A routine's name, shape and movements, as every list of routines shows them. */
export function RoutineDetails({ routine, className = "" }: RoutineDetailsProps) {
  return (
    <div className={`min-w-0 ${className}`}>
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
  );
}
