import { useCallback, useEffect, useState } from "react";

import type { Profile, RoutineSummary, Workout } from "./api";
import { describeFailure, listProfiles, listRoutines, startWorkout } from "./api";
import type { FinishQueue } from "./finishQueue";
import { ProfilePicker } from "./profiles/ProfilePicker";
import { RoutineList } from "./routines/RoutineList";
import { CircleButton } from "./ui/CircleButton";
import { Page } from "./ui/Page";
import { unlockAudio } from "./workout/sound";
import { WorkoutScreen } from "./workout/WorkoutScreen";

interface AppProps {
  readonly queue: FinishQueue;
  /** Resolves once finishes left by an earlier launch have had their try. */
  readonly flushed: Promise<void>;
}

/** The routine list holds an id, so a reload after a workout is never stale. */
type Screen =
  | { readonly name: "picker" }
  | { readonly name: "routines"; readonly profileId: number }
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
  const [failure, setFailure] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>({ name: "picker" });
  const [starting, setStarting] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setFailure(null);
    try {
      const [profiles, routines] = await Promise.all([listProfiles(), listRoutines()]);
      setLibrary({ profiles, routines });
    } catch (error) {
      setFailure(describeFailure(error));
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
    unlockAudio(); // inside the tap: iOS won't let the fetch's callback do it
    setNotice(null);
    setStarting(routine.id);
    try {
      setScreen({ name: "workout", profile, workout: await startWorkout(profile.id, routine.id) });
    } catch (error) {
      setNotice(describeFailure(error));
    } finally {
      setStarting(null);
    }
  };

  const handleWorkoutExit = (profile: Profile) => {
    setScreen({ name: "routines", profileId: profile.id });
    void load(); // sound may have changed mid-workout
  };

  if (screen.name === "workout") {
    return (
      <WorkoutScreen
        profile={screen.profile}
        workout={screen.workout}
        queue={queue}
        onExit={() => handleWorkoutExit(screen.profile)}
      />
    );
  }

  if (!library) {
    return failure ? (
      <Page title="Can't reach the Pi">
        <p className="text-center text-[clamp(18px,4vmin,42px)] font-semibold opacity-85">
          {failure}
        </p>
        <CircleButton onClick={() => void load()}>Retry</CircleButton>
      </Page>
    ) : (
      <Page title="Kettlebell">{null}</Page>
    );
  }

  const profile =
    screen.name === "routines"
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

  return (
    <RoutineList
      profile={profile}
      routines={library.routines}
      starting={starting}
      notice={notice}
      onChoose={(routine) => void handleStart(profile, routine)}
      onBack={() => {
        setNotice(null);
        setScreen({ name: "picker" });
      }}
    />
  );
}
