import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useState } from "react";

import { CircleButton } from "../ui/CircleButton";
import { QuietButton } from "../ui/QuietButton";
import type { Draft, DraftSlot } from "./draft";
import { moveSlot, removeSlot, setWeight } from "./draft";

/** What the exercise picker is choosing for: a new slot, or the one at `index`. */
export type PickTarget =
  | { readonly kind: "add" }
  | { readonly kind: "swap"; readonly index: number };

interface EditorTabsProps {
  readonly draft: Draft;
  readonly problem: string | null;
  readonly update: (change: (draft: Draft) => Draft) => void;
  readonly onPick: (target: PickTarget) => void;
  /** Absent for a routine not yet saved: there is nothing to remove. */
  readonly onRemove?: () => void;
}

// Order and Exercises are one tab: reordering and swapping happen together (#48).
const TABS = ["Weights", "Exercises", "Routine"] as const;
type Tab = (typeof TABS)[number];

const LABEL =
  "text-[clamp(16px,3.4vmin,32px)] font-bold tracking-[0.08em] uppercase opacity-70";
const NAME = "text-[clamp(28px,7vmin,84px)] leading-none font-extrabold break-words";
const CARD = "rounded-[4vmin] bg-white/[0.07] p-[4vmin]";
const WIDE = "w-full max-w-[1100px]";
const FIELD =
  "w-full rounded-[3vmin] bg-white/10 px-[4vmin] py-[3vmin] text-[clamp(28px,7vmin,80px)] font-bold ring-[3px] ring-white/30 outline-none ring-inset placeholder:text-white/35 focus:ring-white";

/**
 * The routine editor as prototyped (#48, variant C): one job at a time, in three
 * tabs. A new routine opens on Routine, since it has nothing to weigh yet.
 */
export function EditorTabs({ draft, problem, update, onPick, onRemove }: EditorTabsProps) {
  const [tab, setTab] = useState<Tab>(draft.id === null ? "Routine" : "Weights");

  return (
    <>
      <nav className={`${WIDE} grid grid-cols-3 gap-[2vmin]`}>
        {TABS.map((each) => (
          <button
            key={each}
            type="button"
            aria-pressed={each === tab}
            onClick={() => setTab(each)}
            className={`min-h-[64px] rounded-[3vmin] py-[3vmin] text-[clamp(14px,3.8vmin,40px)] font-extrabold tracking-[0.04em] uppercase active:scale-95 ${each === tab ? "bg-white text-black" : "bg-white/10"}`}
          >
            {each}
          </button>
        ))}
      </nav>
      {/* Near Save, which sits in the header, not at the foot of a long list. */}
      {problem && (
        <p
          role="alert"
          className="text-center text-[clamp(18px,4vmin,42px)] font-semibold text-red-300"
        >
          {problem}
        </p>
      )}
      {tab === "Weights" && <WeightsTab draft={draft} update={update} onPick={onPick} />}
      {tab === "Exercises" && <ExercisesTab draft={draft} update={update} onPick={onPick} />}
      {tab === "Routine" && <RoutineTab draft={draft} update={update} onRemove={onRemove} />}
    </>
  );
}

type TabProps = Pick<EditorTabsProps, "draft" | "update" | "onPick">;

function WeightsTab({ draft, update, onPick }: TabProps) {
  if (draft.slots.length === 0) return <NoExercises onPick={onPick} />;
  return (
    <ol className={`${WIDE} flex flex-col gap-[3vmin]`}>
      {draft.slots.map((slot, index) => (
        <li key={slot.key} className={`${CARD} flex flex-wrap items-center gap-[3vmin]`}>
          <span className={`${NAME} min-w-0 flex-1`}>{slot.exercise.name}</span>
          <WeightField
            slot={slot}
            onChange={(text) => update((current) => setWeight(current, index, text))}
          />
          {slot.weight.trim() === "" && <p className={`${LABEL} basis-full`}>No weight</p>}
        </li>
      ))}
    </ol>
  );
}

interface WeightFieldProps {
  readonly slot: DraftSlot;
  readonly onChange: (text: string) => void;
}

/** My own weight for one slot, in kg. Emptied is a choice: it trains without one. */
function WeightField({ slot, onChange }: WeightFieldProps) {
  return (
    <label className="flex items-baseline gap-[2vmin]">
      <input
        value={slot.weight}
        onChange={(event) => onChange(event.target.value.replace(/[^\d.,]/g, ""))}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        placeholder="—"
        inputMode="decimal"
        enterKeyHint="done"
        aria-label={`Your weight for ${slot.exercise.name}`}
        className="w-[4ch] rounded-[3vmin] bg-white/10 px-[2vmin] py-[1vmin] text-center text-[clamp(36px,9vmin,96px)] leading-none font-extrabold tabular-nums ring-[3px] ring-white/30 outline-none ring-inset placeholder:text-white/35 focus:ring-white"
      />
      <span className="text-[clamp(24px,6vmin,64px)] font-extrabold opacity-70">kg</span>
    </label>
  );
}

function ExercisesTab({ draft, update, onPick }: TabProps) {
  const last = draft.slots.length - 1;
  return (
    <>
      <ol className={`${WIDE} flex flex-col gap-[3vmin]`}>
        {draft.slots.map((slot, index) => (
          <li key={slot.key} className={`${CARD} flex items-center gap-[3vmin]`}>
            {/* Move on the left, change on the right, the name between (#48). */}
            <Stack>
              <SquareButton
                label={`Move ${slot.exercise.name} up`}
                disabled={index === 0}
                onClick={() => update((current) => moveSlot(current, index, -1))}
              >
                ▲
              </SquareButton>
              <SquareButton
                label={`Move ${slot.exercise.name} down`}
                disabled={index === last}
                onClick={() => update((current) => moveSlot(current, index, 1))}
              >
                ▼
              </SquareButton>
            </Stack>
            <span className="flex min-w-0 flex-1 flex-col gap-[1.5vmin]">
              <span className={NAME}>{slot.exercise.name}</span>
              <span className={LABEL}>
                {slot.weight.trim() === "" ? "No weight" : `${slot.weight} kg`}
              </span>
            </span>
            <Stack>
              <SquareButton
                label={`Remove ${slot.exercise.name}`}
                onClick={() => update((current) => removeSlot(current, index))}
              >
                ✕
              </SquareButton>
              <SquareButton
                label={`Swap ${slot.exercise.name}`}
                onClick={() => onPick({ kind: "swap", index })}
              >
                ⇄
              </SquareButton>
            </Stack>
          </li>
        ))}
      </ol>
      <QuietButton onClick={() => onPick({ kind: "add" })}>＋ Add exercise</QuietButton>
    </>
  );
}

function NoExercises({ onPick }: Pick<TabProps, "onPick">) {
  return (
    <>
      <p className="text-[clamp(20px,4.6vmin,50px)] opacity-70">No exercises yet.</p>
      <QuietButton onClick={() => onPick({ kind: "add" })}>＋ Add exercise</QuietButton>
    </>
  );
}

const Stack = ({ children }: { readonly children: ReactNode }) => (
  <div className="flex flex-col gap-[2vmin]">{children}</div>
);

interface SquareButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly label: string;
}

/** Not a circle: four circles won't fit in a slot row on an iPhone (#48). */
function SquareButton({ label, ...props }: SquareButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      className="flex size-[15vmin] max-h-[110px] min-h-[56px] max-w-[110px] min-w-[56px] flex-none items-center justify-center rounded-[3vmin] bg-white/15 text-[clamp(24px,6vmin,56px)] font-extrabold select-none active:scale-95 disabled:opacity-20"
      {...props}
    />
  );
}

const TIMING = [
  { field: "rounds", label: "Rounds" },
  { field: "work", label: "Work (s)" },
  { field: "rest", label: "Rest (s)" },
] as const;

type RoutineTabProps = Pick<EditorTabsProps, "draft" | "update" | "onRemove">;

function RoutineTab({ draft, update, onRemove }: RoutineTabProps) {
  return (
    <section className={`${WIDE} flex flex-col gap-[4vmin]`}>
      <label className="flex w-full flex-col gap-[1.5vmin]">
        <span className={LABEL}>Name</span>
        <input
          value={draft.name}
          onChange={(event) => {
            const name = event.target.value;
            update((current) => ({ ...current, name }));
          }}
          placeholder="Routine name"
          autoComplete="off"
          autoCapitalize="words"
          enterKeyHint="done"
          className={FIELD}
        />
      </label>
      <div className="grid w-full grid-cols-3 gap-[3vmin]">
        {TIMING.map(({ field, label }) => (
          <label key={field} className="flex min-w-0 flex-col gap-[1.5vmin]">
            <span className={LABEL}>{label}</span>
            <input
              value={draft[field]}
              onChange={(event) => {
                const value = event.target.value.replace(/\D/g, "");
                update((current) => ({ ...current, [field]: value }));
              }}
              inputMode="numeric"
              pattern="[0-9]*"
              enterKeyHint="done"
              className={`${FIELD} px-[2vmin] text-center tabular-nums`}
            />
          </label>
        ))}
      </div>
      {onRemove && (
        <CircleButton variant="outline" className="mt-[4vmin] self-center" onClick={onRemove}>
          Remove
        </CircleButton>
      )}
    </section>
  );
}
