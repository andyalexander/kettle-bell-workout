import { useCallback, useEffect, useRef, useState } from "react";

import type { Profile, RoutineSummary, Workout } from "./api";
import { describeFailure, listProfiles, listRoutines, startWorkout } from "./api";
import type { FinishQueue } from "./finishQueue";
import { ProfilePicker } from "./profiles/ProfilePicker";
import { RoutineEditorPrototype } from "./routines/prototype/RoutineEditorPrototype";
import { RoutineList } from "./routines/RoutineList";
import { CircleButton } from "./ui/CircleButton";
import { Page } from "./ui/Page";
import { WorkoutScreen } from "./workout/WorkoutScreen";

interface AppProps {
  readonly queue: FinishQueue;
  /** Resolves once finishes left by an earlier launch have had their try. */
  readonly flushed: Promise<void>;
}

/** The routine list holds an id, so a reload never leaves it stale. */
type Screen =
  | { readonly name: "picker" }
  | { readonly name: "routines"; readonly profileId: number }
  // PROTOTYPE (#48): null routine is ＋ New routine.
  | { readonly name: "editor"; readonly profileId: number; readonly routineId: number | null }
  | { readonly name: "workout"; readonly profile: Profile; readonly workout: Workout };

interface Library {
  readonly profiles: readonly Profile[];
  readonly routines: readonly RoutineSummary[];
}

/**
 * Picker → routine list → workout, and back to the list (#19). Nothing shows
 * until the pending-finish queue has been flushed.
 */
export function App({ queue, flushed }: AppProps) {
  const [library, setLibrary] = useState<Library | null>(null);
  const [screen, setScreen] = useState<Screen>({ name: "picker" });
  const [startingRoutineId, setStartingRoutineId] = useState<number | null>(null);
  /** Why the last call failed, until the next one — full-page before anything loads. */
  const [problem, setProblem] = useState<string | null>(null);
  /** Bumped by Back, so a Start still on its way lands nowhere. */
  const startRequest = useRef(0);

  const load = useCallback(async () => {
    setProblem(null);
    try {
      const [profiles, routines] = await Promise.all([listProfiles(), listRoutines()]);
      setLibrary({ profiles, routines });
    } catch (error) {
      setProblem(describeFailure(error));
    }
  }, []);

  useEffect(() => {
    void flushed.then(load);
  }, [flushed, load]);

  const handleCreated = (profile: Profile) => {
    setLibrary((current) => current && { ...current, profiles: [...current.profiles, profile] });
    setScreen({ name: "routines", profileId: profile.id });
  };

  const handleStart = async (profile: Profile, routine: RoutineSummary) => {
    const request = ++startRequest.current;
    setProblem(null);
    setStartingRoutineId(routine.id);
    const result = await startWorkout(profile.id, routine.id).then(
      (workout) => ({ workout }),
      (error: unknown) => ({ problem: describeFailure(error) }),
    );
    if (request !== startRequest.current) return;

    setStartingRoutineId(null);
    if ("workout" in result) setScreen({ name: "workout", profile, workout: result.workout });
    else setProblem(result.problem);
  };

  const handleBack = () => {
    startRequest.current += 1;
    setStartingRoutineId(null);
    setProblem(null);
    setScreen({ name: "picker" });
  };

  if (screen.name === "workout") {
    return (
      <WorkoutScreen
        profile={screen.profile}
        workout={screen.workout}
        queue={queue}
        onExit={() => setScreen({ name: "routines", profileId: screen.profile.id })}
      />
    );
  }

  if (!library && problem) {
    return (
      <Page title="Can't reach the Pi">
        <p className="text-center text-[clamp(18px,4vmin,42px)] font-semibold opacity-85">
          {problem}
        </p>
        <CircleButton onClick={() => void load()}>Retry</CircleButton>
      </Page>
    );
  }

  if (!library) return <Page title="Kettlebell" />;

  const profile =
    screen.name === "routines" || screen.name === "editor"
      ? library.profiles.find(({ id }) => id === screen.profileId)
      : undefined;

  if (!profile) {
    return (
      <ProfilePicker
        profiles={library.profiles}
        onChoose={(chosen) => setScreen({ name: "routines", profileId: chosen.id })}
        onCreated={handleCreated}
      />
    );
  }

  if (screen.name === "editor") {
    return (
      <RoutineEditorPrototype
        profile={profile}
        profiles={library.profiles}
        routines={library.routines}
        routine={library.routines.find(({ id }) => id === screen.routineId) ?? null}
        onClose={() => setScreen({ name: "routines", profileId: profile.id })}
      />
    );
  }

  return (
    <RoutineList
      profile={profile}
      routines={library.routines}
      startingRoutineId={startingRoutineId}
      problem={problem}
      onChoose={(routine) => void handleStart(profile, routine)}
      onBack={handleBack}
      onEdit={(routine) =>
        setScreen({ name: "editor", profileId: profile.id, routineId: routine.id })
      }
      onNew={() => setScreen({ name: "editor", profileId: profile.id, routineId: null })}
    />
  );
}
