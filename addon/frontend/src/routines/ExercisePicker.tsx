import type { FormEvent } from "react";
import { useState } from "react";

import type { Exercise } from "../api";
import { createExercise, describeFailure } from "../api";
import { CircleButton } from "../ui/CircleButton";
import { Page } from "../ui/Page";
import { QuietButton } from "../ui/QuietButton";

interface ExercisePickerProps {
  readonly library: readonly Exercise[];
  readonly onPick: (exercise: Exercise) => void;
  /** An exercise just added to the library — by adding it, they have picked it. */
  readonly onAdded: (exercise: Exercise) => void;
  readonly onCancel: () => void;
}

/** The whole library by name, and a quiet way to add to it (#48). */
export function ExercisePicker({ library, onPick, onAdded, onCancel }: ExercisePickerProps) {
  const [adding, setAdding] = useState(false);

  if (adding) return <NewExercise onCancel={() => setAdding(false)} onAdded={onAdded} />;

  return (
    <Page title="Choose an exercise" onBack={onCancel}>
      <ul className="flex w-full max-w-[1100px] flex-col gap-[3vmin]">
        {library.map((exercise) => (
          <li key={exercise.id}>
            <button
              type="button"
              onClick={() => onPick(exercise)}
              className="w-full rounded-[4vmin] bg-white/[0.07] p-[4vmin] text-left text-[clamp(28px,7vmin,84px)] leading-none font-extrabold break-words active:scale-[0.98]"
            >
              {exercise.name}
            </button>
          </li>
        ))}
      </ul>
      <QuietButton onClick={() => setAdding(true)}>＋ New exercise</QuietButton>
    </Page>
  );
}

interface NewExerciseProps {
  readonly onCancel: () => void;
  readonly onAdded: (exercise: Exercise) => void;
}

/** A name and nothing else: exercises carry no weight (ADR-0004). */
function NewExercise({ onCancel, onAdded }: NewExerciseProps) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      onAdded(await createExercise(name.trim()));
    } catch (failure) {
      setError(describeFailure(failure));
      setSaving(false);
    }
  };

  return (
    <Page title="New exercise" onBack={onCancel}>
      <form
        onSubmit={(event) => void handleSubmit(event)}
        className="flex w-full max-w-[900px] flex-col items-center gap-[4vmin]"
      >
        <input
          autoFocus
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setError(null);
          }}
          placeholder="Name"
          aria-label="Name"
          autoComplete="off"
          autoCapitalize="words"
          enterKeyHint="done"
          className="w-full rounded-[3vmin] bg-white/10 px-[4vmin] py-[3vmin] text-center text-[clamp(28px,7vmin,80px)] font-bold ring-[3px] ring-white/30 outline-none ring-inset placeholder:text-white/35 focus:ring-white"
        />
        <p
          role="alert"
          className="min-h-[1.2em] text-center text-[clamp(18px,4vmin,42px)] font-semibold text-red-300"
        >
          {error}
        </p>
        <div className="flex flex-wrap justify-center gap-[3vmin]">
          <CircleButton type="submit" disabled={saving || !name.trim()}>
            Add
          </CircleButton>
          <CircleButton variant="outline" onClick={onCancel}>
            Cancel
          </CircleButton>
        </div>
      </form>
    </Page>
  );
}
