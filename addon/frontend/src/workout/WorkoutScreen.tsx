import type { ReactNode, RefObject } from "react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import type { FinishedWorkout, Profile, Workout } from "../api";
import { setSoundEnabled, toTiming } from "../api";
import type { FinishQueue } from "../finishQueue";
import type { Phase, TimerState } from "../timer/schedule";
import { useWorkoutTimer } from "../timer/useWorkoutTimer";
import { dismissAutoLockHint, shouldShowAutoLockHint } from "../timer/wakeLock";
import { CircleButton } from "../ui/CircleButton";
import type { Flash } from "./display";
import {
  PHASE_WORDS,
  counterLine,
  cueBetween,
  formatClock,
  formatDuration,
  headline,
  loadLabel,
  nextActivity,
  pips,
  summarise,
} from "./display";
import { beep, unlockAudio } from "./sound";
import { useShrinkToFit } from "./useShrinkToFit";

interface WorkoutScreenProps {
  readonly profile: Profile;
  /** Exactly as `startWorkout()` returned it: it goes back to the server untouched. */
  readonly workout: Workout;
  readonly queue: FinishQueue;
  /** Leave the screen — after an abort, which writes nothing, or from the summary. */
  readonly onExit: () => void;
}

const PHASE_BACKGROUNDS: Readonly<Record<Phase, string>> = {
  prep: "bg-prep",
  work: "bg-work",
  rest: "bg-rest",
  done: "bg-ground",
};

const AUTO_LOCK_HINT = "If the screen dims, set Auto-Lock to Never.";

/**
 * The live workout screen (issue #16): variant D of the #4 prototype, rewritten.
 * Starts at prep, runs every turn, and ends on the summary — the moment the
 * workout is recorded. Aborting leaves without a word to the server.
 */
export function WorkoutScreen({ profile, workout, queue, onExit }: WorkoutScreenProps) {
  const timing = useMemo(() => toTiming(workout), [workout]);
  const { state, hold, leadIn, pause, resume } = useWorkoutTimer(timing);
  const [soundOn, setSoundOn] = useState(profile.sound_enabled);
  const [confirmingAbort, setConfirmingAbort] = useState(false);
  const [showHint] = useState(shouldShowAutoLockHint);
  const flashRef = useRef<HTMLDivElement>(null);

  useCues(state, workout.rest_seconds, soundOn, flashRef);
  const finished = useFinish(state, profile.id, workout, queue);

  // Once per device: seen during prep, then gone for good.
  useEffect(() => {
    if (showHint) dismissAutoLockHint();
  }, [showHint]);

  const toggleSound = () => {
    const on = !soundOn;
    setSoundOn(on);
    setSoundEnabled(profile.id, on);
  };

  // Paused and the lead-in share the neutral ground: neither is a phase.
  const background = hold === "running" ? PHASE_BACKGROUNDS[state.phase] : "bg-ground";

  return (
    <main
      className={`fixed inset-0 flex flex-col text-white tabular-nums transition-colors duration-100 ${background}`}
      style={{
        padding:
          "env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)",
      }}
      // A click, not pointerdown, which isn't a gesture for touch. Every tap
      // bubbles here, Resume's included, so a hide's stale audio is replaced.
      onClick={unlockAudio}
    >
      {confirmingAbort ? (
        <Overlay
          title="Abort?"
          message="This workout won't be saved."
          actions={
            <>
              <CircleButton onClick={() => setConfirmingAbort(false)}>Keep going</CircleButton>
              <CircleButton variant="outline" onClick={onExit}>
                Abort
              </CircleButton>
            </>
          }
        />
      ) : hold === "paused" ? (
        <Overlay
          title="Paused"
          message={counterLine(state, workout)}
          actions={
            <>
              <CircleButton onClick={resume}>Resume</CircleButton>
              <CircleButton variant="outline" onClick={() => setConfirmingAbort(true)}>
                Abort
              </CircleButton>
            </>
          }
        />
      ) : state.phase === "done" ? (
        finished && <Summary finished={finished} queue={queue} onExit={onExit} />
      ) : (
        <LiveView
          state={state}
          workout={workout}
          leadIn={leadIn}
          hint={showHint && state.phase === "prep" && leadIn === null ? AUTO_LOCK_HINT : null}
          soundOn={soundOn}
          onToggleSound={toggleSound}
          onPause={pause}
        />
      )}
      <div ref={flashRef} className="pointer-events-none fixed inset-0 z-50 opacity-0" aria-hidden />
    </main>
  );
}

const FLASH_KEYFRAMES: Readonly<Record<Flash, Keyframe[]>> = {
  turn: [{ opacity: 1 }, { opacity: 0 }],
  finish: [{ opacity: 1 }, { opacity: 1, offset: 0.6 }, { opacity: 0 }],
};

const FLASH_STYLE: Readonly<Record<Flash, { color: string; ms: number }>> = {
  turn: { color: "#fff", ms: 450 },
  finish: { color: "var(--color-work)", ms: 1000 },
};

/**
 * Fire each reading's cue: a flash by the Web Animations API, so a turn
 * boundary costs no render, and a beep when this profile has sound on.
 */
function useCues(
  state: TimerState,
  restSeconds: number,
  soundOn: boolean,
  flashRef: RefObject<HTMLDivElement | null>,
): void {
  const previous = useRef(state);

  useEffect(() => {
    const cue = cueBetween(previous.current, state, restSeconds);
    previous.current = state;
    if (cue.flash) {
      const { color, ms } = FLASH_STYLE[cue.flash];
      const element = flashRef.current;
      if (element) {
        element.style.background = color;
        element.animate(FLASH_KEYFRAMES[cue.flash], { duration: ms, easing: "ease-out" });
      }
    }
    if (cue.beep && soundOn) beep(cue.beep);
  }, [state, restSeconds, soundOn, flashRef]);
}

/**
 * Stamp the workout as prep ends and as the last turn ends — UTC to the
 * millisecond, the precision the server keys on — and hand it to the queue
 * exactly once. Returns the finish once there is one, for the summary.
 */
function useFinish(
  state: TimerState,
  profileId: number,
  workout: Workout,
  queue: FinishQueue,
): FinishedWorkout | null {
  const startedAt = useRef<string | null>(null);
  const recorded = useRef(false);
  const [finished, setFinished] = useState<FinishedWorkout | null>(null);

  useEffect(() => {
    if (state.phase === "prep") return;
    startedAt.current ??= new Date().toISOString();
    if (state.phase !== "done" || recorded.current) return;

    recorded.current = true;
    const finish: FinishedWorkout = {
      ...workout,
      profile_id: profileId,
      started_at: startedAt.current,
      ended_at: new Date().toISOString(),
    };
    setFinished(finish);
    void queue.enqueue(finish);
  }, [state.phase, profileId, workout, queue]);

  return finished;
}

interface LiveViewProps {
  readonly state: TimerState;
  readonly workout: Workout;
  /** The lead-in's second, shown where the countdown sits, or null outside one. */
  readonly leadIn: number | null;
  readonly hint: string | null;
  readonly soundOn: boolean;
  readonly onToggleSound: () => void;
  readonly onPause: () => void;
}

const LEAD_IN_WORD = "Get ready";

/**
 * Variant D: what and how heavy at the top, the countdown dominating, controls
 * at the foot. During a lead-in the 3-2-1 takes the countdown's place.
 */
function LiveView({ state, workout, leadIn, hint, soundOn, onToggleSound, onPause }: LiveViewProps) {
  const { activity, upcoming } = headline(state, workout);
  const next = upcoming ? null : nextActivity(state, workout);
  const pipRow = pips(state, workout.activities.length);
  const name = upcoming ? `Next: ${activity.exercise_name}` : activity.exercise_name;
  const nameRef = useShrinkToFit<HTMLHeadingElement>(name);

  return (
    <>
      <header className="px-[4vmin] pt-[3vmin]">
        <p className="text-[clamp(18px,4.2vmin,44px)] font-bold tracking-[0.04em] uppercase opacity-90">
          {state.phase === "prep" ? workout.routine_name : counterLine(state, workout)}
        </p>
        {pipRow ? (
          <div className="mt-[1.8vmin] mb-[2.6vmin] flex gap-[1.2vmin]">
            {pipRow.map((pip, i) => (
              <i key={i} className={`h-[2.4vh] min-h-3 flex-1 rounded-full ${PIP_COLOURS[pip]}`} />
            ))}
          </div>
        ) : (
          <div className="h-[2vmin]" />
        )}
        <h1
          ref={nameRef}
          className="line-clamp-2 text-[clamp(34px,9.6vmin,112px)] leading-[0.98] font-extrabold tracking-[-0.025em]"
        >
          {name}
        </h1>
        <p className="mt-[1.2vmin] text-[clamp(26px,6.6vmin,74px)] font-bold opacity-95">
          {loadLabel(activity)}
        </p>
      </header>

      <section className="flex flex-1 flex-col items-center justify-center">
        <p className="text-[clamp(18px,4vmin,42px)] font-extrabold tracking-[0.12em] uppercase opacity-90">
          {leadIn === null ? PHASE_WORDS[state.phase] : LEAD_IN_WORD}
        </p>
        <p className="text-[clamp(120px,42vmin,460px)] leading-[0.85] font-extrabold tracking-[-0.03em]">
          {leadIn ?? formatClock(state.secondsRemaining)}
        </p>
      </section>

      <footer className="flex items-end justify-between gap-[3vmin] p-[4vmin]">
        <p
          className={`flex-1 ${hint ? "text-[clamp(18px,4vmin,40px)] font-bold" : "text-[clamp(15px,3vmin,30px)] opacity-75"}`}
        >
          {hint ?? (next && `Next: ${next.exercise_name} · ${loadLabel(next)}`)}
        </p>
        <CircleButton
          variant="tinted"
          onClick={onToggleSound}
          aria-label={soundOn ? "Turn sound off" : "Turn sound on"}
          aria-pressed={soundOn}
        >
          <SpeakerIcon on={soundOn} />
        </CircleButton>
        <CircleButton variant="tinted" onClick={onPause}>
          Pause
        </CircleButton>
      </footer>
    </>
  );
}

const PIP_COLOURS = { done: "bg-white/55", now: "bg-white", todo: "bg-black/30" } as const;

function SpeakerIcon({ on }: { readonly on: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="size-1/2" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 5 6 9H2v6h4l5 4z" fill="currentColor" />
      {on ? (
        <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" />
      ) : (
        <path d="m16 9 6 6m0-6-6 6" />
      )}
    </svg>
  );
}

interface SummaryProps {
  readonly finished: FinishedWorkout;
  readonly queue: FinishQueue;
  readonly onExit: () => void;
}

const SAVE_STATUS = {
  saving: "Saving…",
  retrying: "Not saved yet — retrying",
  saved: "Saved",
} as const;

/** This workout only (#13), so it reads the same whether or not the Pi answered. */
function Summary({ finished, queue, onExit }: SummaryProps) {
  const status = useSyncExternalStore(queue.subscribe, queue.status);
  const { turns, underLoadSeconds, elapsedSeconds } = summarise(
    finished,
    finished.started_at,
    finished.ended_at,
  );

  return (
    <Overlay
      title="Done"
      message={
        <>
          <p>{finished.routine_name}</p>
          <p>
            {turns} turns · {formatDuration(underLoadSeconds)} under load ·{" "}
            {formatDuration(elapsedSeconds)} in all
          </p>
          <p className="mt-[2vmin] opacity-70">{SAVE_STATUS[status]}</p>
        </>
      }
      actions={<CircleButton onClick={onExit}>Done</CircleButton>}
    />
  );
}

interface OverlayProps {
  readonly title: string;
  readonly message: ReactNode;
  readonly actions: ReactNode;
}

/** Paused, abort and done share one shape: a word, a line, round buttons. */
function Overlay({ title, message, actions }: OverlayProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-[4vmin] p-[6vmin] text-center">
      <h1 className="text-[clamp(40px,12vmin,150px)] font-extrabold tracking-[0.05em] uppercase">
        {title}
      </h1>
      <div className="text-[clamp(18px,4vmin,42px)] font-semibold opacity-85">{message}</div>
      <div className="flex flex-wrap justify-center gap-[3vmin]">{actions}</div>
    </div>
  );
}
