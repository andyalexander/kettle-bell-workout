// PROTOTYPE (#48), throwaway: what should the routine editor look like on the
// iPhone and iPad? Three layouts of the same editor, switched by `?variant=` and
// the yellow bar at the very bottom. The routine and its weights are real, from
// the Mac's scratch database; the library, other people's overrides and Save are
// stubs in memory, so nothing is ever written. Delete once a variant has won.
import { useEffect, useState } from "react";

import type { Profile, RoutineSummary } from "../../api";
import { describeFailure, startWorkout } from "../../api";
import { CircleButton } from "../../ui/CircleButton";
import { Page } from "../../ui/Page";
import { PrototypeSwitcher, useVariant } from "../../ui/PrototypeSwitcher";
import type { Draft, DraftSlot, HeldOverride, LibraryExercise, PickTarget } from "./model";
import {
  STUB_LIBRARY,
  addSlot,
  deleteWarnings,
  draftFromWorkout,
  kg,
  newDraft,
  problemFor,
  stubOthers,
  swapExercise,
  warningsFor,
} from "./model";
import { VariantA, VariantB, VariantC } from "./variants";

const EDITOR_VARIANTS = { A: "One page", B: "Tap a slot", C: "Modes" } as const;
type EditorVariant = keyof typeof EDITOR_VARIANTS;
const KEYS = Object.keys(EDITOR_VARIANTS) as EditorVariant[];
const VARIANT_COMPONENTS = { A: VariantA, B: VariantB, C: VariantC } as const;

interface Loaded {
  readonly draft: Draft;
  /** The slots as saved, which every override is held against. */
  readonly saved: readonly DraftSlot[];
  readonly others: readonly HeldOverride[];
}

type Overlay =
  | { readonly kind: "picker"; readonly target: PickTarget }
  | { readonly kind: "newExercise"; readonly target: PickTarget }
  | { readonly kind: "warning"; readonly lines: readonly string[]; readonly action: "save" | "delete" }
  | { readonly kind: "done"; readonly action: "save" | "delete" };

interface RoutineEditorPrototypeProps {
  readonly profile: Profile;
  readonly profiles: readonly Profile[];
  readonly routines: readonly RoutineSummary[];
  /** Null for ＋ New routine. */
  readonly routine: RoutineSummary | null;
  readonly onClose: () => void;
}

export function RoutineEditorPrototype({
  profile,
  profiles,
  routines,
  routine,
  onClose,
}: RoutineEditorPrototypeProps) {
  const variant = useVariant(KEYS);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [library, setLibrary] = useState<readonly LibraryExercise[]>(STUB_LIBRARY);
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!routine) {
      setLoaded({ draft: newDraft(), saved: [], others: [] });
      return;
    }
    let live = true;
    startWorkout(profile.id, routine.id).then(
      (workout) => {
        if (!live) return;
        const draft = draftFromWorkout(workout, STUB_LIBRARY);
        setLoaded({ draft, saved: draft.slots, others: stubOthers(profiles, profile, draft.slots) });
      },
      (error: unknown) => live && setProblem(describeFailure(error)),
    );
    return () => {
      live = false;
    };
  }, [profile, profiles, routine]);

  // A block body: Chromium's scrollTo now returns a promise, which React would
  // take for a clean-up function.
  useEffect(() => {
    scrollTo(0, 0);
  }, [overlay]);

  const title = routine ? "Edit routine" : "New routine";
  const switcher = (summary: string) => (
    <PrototypeSwitcher variants={EDITOR_VARIANTS}>{summary}</PrototypeSwitcher>
  );

  if (!loaded) {
    return (
      <>
        <Page title={title} onBack={onClose}>
          {problem && <p className="text-red-300">{problem}</p>}
        </Page>
        {switcher("loading")}
      </>
    );
  }

  const { draft, saved, others } = loaded;
  const warnings = warningsFor(saved, draft.slots, others);

  const update = (change: (current: Draft) => Draft) => {
    setProblem(null);
    setLoaded((current) => current && { ...current, draft: change(current.draft) });
  };

  const handlePick = (target: PickTarget, exercise: LibraryExercise) => {
    update((current) =>
      target.kind === "add" ? addSlot(current, exercise) : swapExercise(current, target.index, exercise),
    );
    setOverlay(null);
  };

  const handleNewExercise = (target: PickTarget, name: string) => {
    const exercise = { id: Math.max(...library.map(({ id }) => id)) + 1, name };
    setLibrary([...library, exercise]);
    handlePick(target, exercise);
  };

  const handleSave = () => {
    const refusal = problemFor(draft, routines);
    if (refusal) setProblem(refusal);
    else if (warnings.length > 0) setOverlay({ kind: "warning", lines: warnings, action: "save" });
    else setOverlay({ kind: "done", action: "save" });
  };

  const Variant = VARIANT_COMPONENTS[variant];
  return (
    <>
      <div hidden={overlay !== null}>
        <Variant
          title={title}
          draft={draft}
          isNew={routine === null}
          problem={problem}
          update={update}
          onPick={(target) => setOverlay({ kind: "picker", target })}
          onSave={handleSave}
          onDelete={() =>
            setOverlay({ kind: "warning", lines: deleteWarnings(saved, others), action: "delete" })
          }
          onCancel={onClose}
        />
      </div>
      {overlay?.kind === "picker" && (
        <ExercisePicker
          library={library}
          onPick={(exercise) => handlePick(overlay.target, exercise)}
          onNew={() => setOverlay({ kind: "newExercise", target: overlay.target })}
          onCancel={() => setOverlay(null)}
        />
      )}
      {overlay?.kind === "newExercise" && (
        <NewExercise
          library={library}
          onAdd={(name) => handleNewExercise(overlay.target, name)}
          onCancel={() => setOverlay({ kind: "picker", target: overlay.target })}
        />
      )}
      {overlay?.kind === "warning" && (
        <WarningScreen
          lines={overlay.lines}
          action={overlay.action}
          onConfirm={() => setOverlay({ kind: "done", action: overlay.action })}
          onBack={() => setOverlay(null)}
        />
      )}
      {overlay?.kind === "done" && (
        <WouldSave
          draft={draft}
          action={overlay.action}
          onKeepEditing={() => setOverlay(null)}
          onClose={onClose}
        />
      )}
      {switcher(`${draft.slots.length} slots · ⚠ ${warnings.length}`)}
    </>
  );
}

const ROW =
  "flex w-full items-center gap-[4vmin] rounded-[4vmin] bg-white/[0.07] p-[4vmin] text-left active:scale-[0.98]";
const ROW_NAME = "min-w-0 flex-1 text-[clamp(28px,7vmin,84px)] leading-none font-extrabold break-words";
const INPUT =
  "w-full rounded-[3vmin] bg-white/10 px-[4vmin] py-[3vmin] text-center text-[clamp(28px,7vmin,80px)] font-bold ring-[3px] ring-white/30 outline-none ring-inset placeholder:text-white/35 focus:ring-white";

interface ExercisePickerProps {
  readonly library: readonly LibraryExercise[];
  readonly onPick: (exercise: LibraryExercise) => void;
  readonly onNew: () => void;
  readonly onCancel: () => void;
}

function ExercisePicker({ library, onPick, onNew, onCancel }: ExercisePickerProps) {
  return (
    <Page title="Choose an exercise" onBack={onCancel}>
      <ul className="flex w-full max-w-[1100px] flex-col gap-[3vmin]">
        {library.map((exercise) => (
          <li key={exercise.id}>
            <button type="button" className={ROW} onClick={() => onPick(exercise)}>
              <span className={ROW_NAME}>{exercise.name}</span>
            </button>
          </li>
        ))}
        <li>
          <button
            type="button"
            onClick={onNew}
            className="w-full rounded-[4vmin] border-[3px] border-dashed border-white/30 p-[5vmin] text-[clamp(24px,6vmin,64px)] font-extrabold active:scale-[0.98]"
          >
            ＋ New exercise
          </button>
        </li>
      </ul>
    </Page>
  );
}

interface NewExerciseProps {
  readonly library: readonly LibraryExercise[];
  readonly onAdd: (name: string) => void;
  readonly onCancel: () => void;
}

/** A name and nothing else: exercises carry no weight (#47, amended). */
function NewExercise({ library, onAdd, onCancel }: NewExerciseProps) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleAdd = () => {
    const trimmed = name.trim();
    if (library.some((each) => each.name.toLowerCase() === trimmed.toLowerCase())) {
      setError(`There's already a ${trimmed}.`);
    } else onAdd(trimmed);
  };

  return (
    <Page title="New exercise" onBack={onCancel}>
      <div className="flex w-full max-w-[900px] flex-col items-center gap-[4vmin]">
        <input
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Name"
          aria-label="Name"
          autoComplete="off"
          autoCapitalize="words"
          className={INPUT}
        />
        <p role="alert" className="min-h-[1.2em] text-[clamp(18px,4vmin,42px)] font-semibold text-red-300">
          {error}
        </p>
        <div className="flex flex-wrap justify-center gap-[3vmin]">
          <CircleButton disabled={!name.trim()} onClick={handleAdd}>
            Add
          </CircleButton>
          <CircleButton variant="outline" onClick={onCancel}>
            Cancel
          </CircleButton>
        </div>
      </div>
    </Page>
  );
}

interface WarningScreenProps {
  readonly lines: readonly string[];
  readonly action: "save" | "delete";
  readonly onConfirm: () => void;
  readonly onBack: () => void;
}

/** In-app, never a browser dialog; the safe action leads, as abort's does (#4). */
function WarningScreen({ lines, action, onConfirm, onBack }: WarningScreenProps) {
  return (
    <Page title={action === "delete" ? "⚠️ Delete this routine?" : "⚠️ This moves someone's weights"}>
      <ul className="flex w-full max-w-[1100px] flex-col gap-[3vmin]">
        {lines.map((line) => (
          <li
            key={line}
            className="rounded-[4vmin] bg-amber-400/15 p-[4vmin] text-[clamp(22px,5.4vmin,60px)] leading-tight font-bold"
          >
            {line}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap justify-center gap-[4vmin]">
        <CircleButton onClick={onBack}>Go back</CircleButton>
        <CircleButton variant="outline" onClick={onConfirm}>
          {action === "delete" ? "Delete" : "Save anyway"}
        </CircleButton>
      </div>
    </Page>
  );
}

interface WouldSaveProps {
  readonly draft: Draft;
  readonly action: "save" | "delete";
  readonly onKeepEditing: () => void;
  readonly onClose: () => void;
}

/** The stub's Save: what the API would be sent. Nothing is written. */
function WouldSave({ draft, action, onKeepEditing, onClose }: WouldSaveProps) {
  return (
    <Page title={action === "delete" ? "Would delete" : "Would save"}>
      <p className="text-[clamp(18px,4vmin,42px)] font-semibold text-yellow-300">
        Prototype: nothing was written.
      </p>
      {action === "save" && (
        <div className="w-full max-w-[1100px] text-[clamp(20px,4.6vmin,50px)] font-bold">
          <p>
            {draft.name} · {draft.rounds} rounds · {draft.work}/{draft.rest}
          </p>
          <ol className="mt-[3vmin] flex flex-col gap-[2vmin]">
            {draft.slots.map((slot, index) => (
              <li key={slot.key}>
                {index + 1}. {slot.exercise.name} · {slot.weight === null ? "no weight" : kg(slot.weight)}
              </li>
            ))}
          </ol>
        </div>
      )}
      <div className="flex flex-wrap justify-center gap-[4vmin]">
        <CircleButton onClick={onClose}>Done</CircleButton>
        <CircleButton variant="outline" onClick={onKeepEditing}>
          Keep editing
        </CircleButton>
      </div>
    </Page>
  );
}
