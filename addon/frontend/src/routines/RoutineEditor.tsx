import { useEffect, useState } from "react";

import type { Exercise, Profile } from "../api";
import {
  createRoutine,
  damageIn,
  deleteRoutine,
  describeFailure,
  getRoutine,
  listExercises,
  saveRoutine,
} from "../api";
import { CircleButton } from "../ui/CircleButton";
import { Page } from "../ui/Page";
import type { Draft } from "./draft";
import {
  addSlot,
  damageLine,
  draftOf,
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
  /** Null for ＋ New routine. */
  readonly routineId: number | null;
  /** The routine's name as the list shows it, for the title while it loads. */
  readonly routineName: string | null;
  /** `changed` when a save or delete went through, so the list must reload. */
  readonly onClose: (changed: boolean) => void;
}

interface Loaded {
  readonly draft: Draft;
  readonly library: readonly Exercise[];
}

const KEPT = "Recorded workouts are kept.";

/**
 * The ⚠️ before a save or delete goes through. A delete always asks first; the
 * server adds the lines of anyone else's weights it would lose, and the answer
 * after those is sent confirmed.
 */
type Warning =
  | { readonly action: "save"; readonly lines: readonly string[] }
  | { readonly action: "delete"; readonly lines: readonly string[]; readonly confirmed: boolean };

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
      ([opened, library]) => live && setLoaded({ draft: opened, library }),
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

  /** Run a save or delete; a 409 opens the ⚠️, anything else is said plainly. */
  const attempt = async (call: () => Promise<unknown>, onDamage: (lines: string[]) => void) => {
    setBusy(true);
    setProblem(null);
    try {
      await call();
      onClose(true);
    } catch (error) {
      const damage = damageIn(error);
      if (damage) onDamage(damage.map(damageLine));
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

  const handleDelete = (id: number, confirmed: boolean) => {
    void attempt(
      () => deleteRoutine(profile.id, id, confirmed),
      (lines) =>
        setOverlay({ kind: "warning", action: "delete", lines: [...lines, KEPT], confirmed: true }),
    );
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

  const savedId = draft.id;
  const deleting = overlay?.kind === "warning" && overlay.action === "delete";

  return (
    <>
      {/* Hidden, never unmounted, under an overlay: coming back keeps the tab you were on. */}
      <div hidden={overlay !== null}>
        <Page
          title={draft.name.trim() || fallbackTitle}
          onBack={() => onClose(false)}
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
            onDelete={
              savedId === null
                ? undefined
                : () =>
                    setOverlay({ kind: "warning", action: "delete", lines: [KEPT], confirmed: false })
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
          title={deleting ? "⚠️ Delete this routine?" : "⚠️ This moves someone's weights"}
          lines={overlay.lines}
          confirmLabel={deleting ? "Delete" : "Save anyway"}
          busy={busy}
          problem={problem}
          onConfirm={() => {
            if (overlay.action === "save") handleSave(true);
            else if (savedId !== null) handleDelete(savedId, overlay.confirmed);
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
