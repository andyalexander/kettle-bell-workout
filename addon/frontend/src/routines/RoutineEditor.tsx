import { useEffect, useState } from "react";

import type { Exercise, Profile } from "../api";
import {
  createRoutine,
  damageIn,
  describeFailure,
  getRoutine,
  listExercises,
  removeFromList,
  saveRoutine,
} from "../api";
import { CircleButton } from "../ui/CircleButton";
import { Page } from "../ui/Page";
import type { Draft } from "./draft";
import {
  addSlot,
  damageLine,
  draftOf,
  isChanged,
  newDraft,
  problemWith,
  saveBody,
  swapExercise,
} from "./draft";
import type { PickTarget } from "./EditorTabs";
import { EditorTabs } from "./EditorTabs";
import { ExercisePicker } from "./ExercisePicker";
import { WarningScreen } from "./WarningScreen";

interface RoutineEditorProps {
  readonly profile: Profile;
  /** Null for ＋ Create new. */
  readonly routineId: number | null;
  /** The routine's name as the list shows it, for the title while it loads. */
  readonly routineName: string | null;
  /** `changed` when a save or removal went through, so the lists must reload. */
  readonly onClose: (changed: boolean) => void;
}

interface Loaded {
  readonly draft: Draft;
  /** The draft as it opened, so Back can tell whether it would lose an edit. */
  readonly opened: Draft;
  readonly library: readonly Exercise[];
}

/** Removing takes a routine off this profile's list alone (ADR-0005). */
const REMOVED = [
  "It stays under ＋ New routine, to add back any time.",
  "Your weights on it and your recorded workouts are kept.",
];
const UNSAVED = "Your changes haven't been saved.";

/**
 * The ⚠️ before a save, removal or discard goes through. A save asks only when
 * the server says it would move someone else's weight, and the answer is sent
 * confirmed. Remove always asks first. Back asks only when it would lose an edit.
 */
type Warning =
  | { readonly action: "save"; readonly lines: readonly string[] }
  | { readonly action: "remove"; readonly lines: readonly string[] }
  | { readonly action: "discard"; readonly lines: readonly string[] };

const WARNING_TEXT = {
  save: { title: "⚠️ This moves someone's weights", confirmLabel: "Save anyway" },
  remove: { title: "Take this off your list?", confirmLabel: "Remove" },
  discard: { title: "⚠️ Leave without saving?", confirmLabel: "Discard", backLabel: "Keep editing" },
} as const;

type Overlay =
  | { readonly kind: "picker"; readonly target: PickTarget }
  | ({ readonly kind: "warning" } & Warning);

/**
 * Edit one routine as one profile (#50): its shape for everyone, and this
 * profile's own weights (ADR-0004). Nothing reaches the server until Save.
 */
export function RoutineEditor({ profile, routineId, routineName, onClose }: RoutineEditorProps) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    const draft = routineId === null ? Promise.resolve(newDraft()) : getRoutine(profile.id, routineId).then(draftOf);
    Promise.all([draft, listExercises()]).then(
      ([opened, library]) => live && setLoaded({ draft: opened, opened, library }),
      (error: unknown) => live && setProblem(describeFailure(error)),
    );
    return () => {
      live = false;
    };
  }, [profile.id, routineId]);

  // A block body: Chromium's scrollTo returns a promise, which React would take
  // for a clean-up function.
  useEffect(() => {
    scrollTo(0, 0);
  }, [overlay]);

  const fallbackTitle = routineName ?? "New routine";
  if (!loaded) {
    return (
      <Page title={fallbackTitle} onBack={() => onClose(false)}>
        {problem && (
          <p role="alert" className="text-center text-[clamp(18px,4vmin,42px)] font-semibold text-red-300">
            {problem}
          </p>
        )}
      </Page>
    );
  }

  const { draft, library } = loaded;

  const update = (change: (current: Draft) => Draft) => {
    setProblem(null);
    setLoaded((current) => current && { ...current, draft: change(current.draft) });
  };

  /** Run a save or removal; a save's 409 opens the ⚠️, anything else is said plainly. */
  const attempt = async (call: () => Promise<unknown>, onDamage?: (lines: string[]) => void) => {
    setBusy(true);
    setProblem(null);
    try {
      await call();
      onClose(true);
    } catch (error) {
      const damage = damageIn(error);
      if (damage && onDamage) onDamage(damage.map(damageLine));
      else setProblem(describeFailure(error));
      setBusy(false);
    }
  };

  const handleSave = (confirmed: boolean) => {
    const refusal = problemWith(draft);
    if (refusal) {
      setProblem(refusal);
      return;
    }
    const body = saveBody(draft);
    const call = () =>
      draft.id === null
        ? createRoutine(profile.id, body)
        : saveRoutine(profile.id, draft.id, body, confirmed);
    void attempt(call, (lines) => setOverlay({ kind: "warning", action: "save", lines }));
  };

  const handleRemove = (id: number) => {
    void attempt(() => removeFromList(profile.id, id));
  };

  const handlePicked = (target: PickTarget, exercise: Exercise) => {
    update((current) =>
      target.kind === "add" ? addSlot(current, exercise) : swapExercise(current, target.index, exercise),
    );
    setOverlay(null);
  };

  const handleAdded = (target: PickTarget, exercise: Exercise) => {
    setLoaded((current) => current && { ...current, library: [...current.library, exercise] });
    handlePicked(target, exercise);
  };

  const handleBack = () => {
    if (isChanged(loaded.opened, draft)) {
      setOverlay({ kind: "warning", action: "discard", lines: [UNSAVED] });
    } else {
      onClose(false);
    }
  };

  const savedId = draft.id;

  return (
    <>
      {/* Hidden, never unmounted, under an overlay: coming back keeps the tab you were on. */}
      <div hidden={overlay !== null}>
        <Page
          title={draft.name.trim() || fallbackTitle}
          onBack={handleBack}
          action={
            <CircleButton disabled={busy} onClick={() => handleSave(false)}>
              {busy ? "…" : "Save"}
            </CircleButton>
          }
        >
          <EditorTabs
            draft={draft}
            problem={overlay === null ? problem : null}
            update={update}
            onPick={(target) => setOverlay({ kind: "picker", target })}
            onRemove={
              savedId === null
                ? undefined
                : () => setOverlay({ kind: "warning", action: "remove", lines: REMOVED })
            }
          />
        </Page>
      </div>
      {overlay?.kind === "picker" && (
        <ExercisePicker
          library={library}
          onPick={(exercise) => handlePicked(overlay.target, exercise)}
          onAdded={(exercise) => handleAdded(overlay.target, exercise)}
          onCancel={() => setOverlay(null)}
        />
      )}
      {overlay?.kind === "warning" && (
        <WarningScreen
          {...WARNING_TEXT[overlay.action]}
          lines={overlay.lines}
          busy={busy}
          problem={problem}
          onConfirm={() => {
            if (overlay.action === "save") handleSave(true);
            else if (overlay.action === "discard") onClose(false);
            else if (savedId !== null) handleRemove(savedId);
          }}
          onBack={() => {
            setProblem(null);
            setOverlay(null);
          }}
        />
      )}
    </>
  );
}
