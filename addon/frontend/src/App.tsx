import { useCallback, useEffect, useRef, useState } from "react";

import type { Profile, RoutineSummary, Workout } from "./api";
import { describeFailure, listProfiles, listRoutines, startWorkout } from "./api";
import type { FinishQueue } from "./finishQueue";
import { ProfilePicker } from "./profiles/ProfilePicker";
import { RoutineEditor } from "./routines/RoutineEditor";
import { RoutineList } from "./routines/RoutineList";
import { CircleButton } from "./ui/CircleButton";
import { Page } from "./ui/Page";
import { WorkoutScreen } from "./workout/WorkoutScreen";

interface AppProps {
  readonly queue: FinishQueue;
  /** Resolves once finishes left by an earlier launch have had their try. */
  readonly flushed: Promise<void>;
}

/** The routine list and editor hold ids, so a reload never leaves them stale. */
type Screen =
  | { readonly name: "picker" }
  | { readonly name: "routines"; readonly profileId: number }
  | {
      readonly name: "editor";
      readonly profileId: number;
      /** Null for ＋ New routine. */
      readonly routine: RoutineSummary | null;
    }
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

  /** After a save or delete: the list shows every routine as it now is. */
  const reloadRoutines = async () => {
    try {
      const routines = await listRoutines();
      setLibrary((current) => current && { ...current, routines });
    } catch (error) {
      setProblem(describeFailure(error));
    }
  };

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
      <RoutineEditor
        profile={profile}
        routineId={screen.routine?.id ?? null}
        routineName={screen.routine?.name ?? null}
        onClose={(changed) => {
          if (changed) void reloadRoutines();
          setScreen({ name: "routines", profileId: profile.id });
        }}
      />
    );
  }

  const openEditor = (routine: RoutineSummary | null) => {
    setProblem(null);
    setScreen({ name: "editor", profileId: profile.id, routine });
  };

  return (
    <RoutineList
      profile={profile}
      routines={library.routines}
      startingRoutineId={startingRoutineId}
      problem={problem}
      onChoose={(routine) => void handleStart(profile, routine)}
      onEdit={openEditor}
      onNew={() => openEditor(null)}
      onBack={handleBack}
    />
  );
}
