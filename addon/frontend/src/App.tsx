import { useCallback, useEffect, useRef, useState } from "react";

import type { Profile, RoutineSummary, Workout } from "./api";
import { describeFailure, listProfiles, listRoutines, startWorkout } from "./api";
import type { FinishQueue } from "./finishQueue";
import { ProfilePicker } from "./profiles/ProfilePicker";
import { splitLibrary } from "./routines/library";
import { RoutineEditor } from "./routines/RoutineEditor";
import { RoutineLibrary } from "./routines/RoutineLibrary";
import { RoutineList } from "./routines/RoutineList";
import { CircleButton } from "./ui/CircleButton";
import { Page } from "./ui/Page";
import { WorkoutScreen } from "./workout/WorkoutScreen";

interface AppProps {
  readonly queue: FinishQueue;
  /** Resolves once finishes left by an earlier launch have had their try. */
  readonly flushed: Promise<void>;
}

/** The routine screens hold ids, so a reload never leaves them stale. */
type Screen =
  | { readonly name: "picker" }
  | { readonly name: "routines"; readonly profileId: number }
  // ＋ New routine: the library's routines not on the list yet, or one from nothing.
  | { readonly name: "library"; readonly profileId: number }
  | {
      readonly name: "editor";
      readonly profileId: number;
      /** Null for ＋ Create new. */
      readonly routine: RoutineSummary | null;
    }
  | { readonly name: "workout"; readonly profile: Profile; readonly workout: Workout };

interface Library {
  /** Everyone, each with the ids of the routines on their list (ADR-0005). */
  readonly profiles: readonly Profile[];
  /** The whole routine library. */
  readonly routines: readonly RoutineSummary[];
}

/**
 * Picker → routine list → workout, and back to the list (#19). ＋ New routine
 * goes by way of the library (ADR-0005). Nothing shows until the pending-finish
 * queue has been flushed.
 */
export function App({ queue, flushed }: AppProps) {
  const [library, setLibrary] = useState<Library | null>(null);
  const [screen, setScreen] = useState<Screen>({ name: "picker" });
  const [startingRoutineId, setStartingRoutineId] = useState<number | null>(null);
  /** Why the last call failed, until the next one — full-page before anything loads. */
  const [problem, setProblem] = useState<string | null>(null);
  /** Bumped by Back, so a Start still on its way lands nowhere. */
  const startRequest = useRef(0);

  /** At launch, and again after a save, an add or a removal changes the lists. */
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
    "profileId" in screen
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

  const showRoutines = () => setScreen({ name: "routines", profileId: profile.id });

  const openLibrary = () => {
    setProblem(null);
    setScreen({ name: "library", profileId: profile.id });
  };

  const openEditor = (routine: RoutineSummary | null) => {
    setProblem(null);
    setScreen({ name: "editor", profileId: profile.id, routine });
  };

  if (screen.name === "editor") {
    const creating = screen.routine === null;
    return (
      <RoutineEditor
        profile={profile}
        routineId={screen.routine?.id ?? null}
        routineName={screen.routine?.name ?? null}
        onClose={(changed) => {
          if (changed) void load();
          // Backing out of ＋ Create new returns to the library it was opened from.
          if (creating && !changed) openLibrary();
          else showRoutines();
        }}
      />
    );
  }

  const { listed, unlisted } = splitLibrary(library.routines, profile);

  if (screen.name === "library") {
    return (
      <RoutineLibrary
        profile={profile}
        routines={unlisted}
        onAdded={async () => {
          await load();
          showRoutines();
        }}
        onCreate={() => openEditor(null)}
        onBack={showRoutines}
      />
    );
  }

  return (
    <RoutineList
      profile={profile}
      routines={listed}
      startingRoutineId={startingRoutineId}
      problem={problem}
      onChoose={(routine) => void handleStart(profile, routine)}
      onEdit={openEditor}
      onNew={openLibrary}
      onBack={handleBack}
    />
  );
}
