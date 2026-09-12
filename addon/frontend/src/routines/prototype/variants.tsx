// PROTOTYPE (#48), throwaway: three layouts of the routine editor.
//   A · One page   — everything on one scrolling form, ▲ ▼ ✕ on every slot.
//   B · Tap a slot — a read-only list; each slot opens its own screen of circles.
//   C · Modes      — Weights / Order / Exercises / Routine, one job at a time,
//                    with Save pinned to the corner.
// Every weight shown is the viewer's own; an empty box trains without one.
import type { ButtonHTMLAttributes } from "react";
import { useEffect, useState } from "react";

import { CircleButton } from "../../ui/CircleButton";
import { Page } from "../../ui/Page";
import type { Draft, DraftSlot, PickTarget } from "./model";
import { moveSlot, removeSlot, setWeight, shownWeight } from "./model";

export interface EditorProps {
  readonly title: string;
  readonly draft: Draft;
  readonly isNew: boolean;
  readonly problem: string | null;
  readonly update: (change: (draft: Draft) => Draft) => void;
  readonly onPick: (target: PickTarget) => void;
  readonly onSave: () => void;
  readonly onDelete: () => void;
  readonly onCancel: () => void;
}

// --- shared pieces: inputs and small parts, never a layout -------------------

const INPUT =
  "w-full rounded-[3vmin] bg-white/10 px-[4vmin] py-[3vmin] text-[clamp(28px,7vmin,80px)] font-bold ring-[3px] ring-white/30 outline-none ring-inset placeholder:text-white/35 focus:ring-white";
const LABEL =
  "text-[clamp(16px,3.4vmin,32px)] font-bold tracking-[0.08em] uppercase opacity-70";
const NAME = "text-[clamp(28px,7vmin,84px)] leading-none font-extrabold break-words";
const CARD = "rounded-[4vmin] bg-white/[0.07] p-[4vmin]";
const WIDE = "w-full max-w-[1100px]";

function Problem({ problem }: { readonly problem: string | null }) {
  if (!problem) return null;
  return (
    <p
      role="alert"
      className="text-center text-[clamp(18px,4vmin,42px)] font-semibold text-red-300"
    >
      {problem}
    </p>
  );
}

function NameField({ draft, update }: Pick<EditorProps, "draft" | "update">) {
  return (
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
        className={INPUT}
      />
    </label>
  );
}

const TIMING = [
  { field: "rounds", label: "Rounds" },
  { field: "work", label: "Work (s)" },
  { field: "rest", label: "Rest (s)" },
] as const;

function TimingFields({ draft, update }: Pick<EditorProps, "draft" | "update">) {
  return (
    <div className="grid w-full grid-cols-3 gap-[3vmin]">
      {TIMING.map(({ field, label }) => (
        <label key={field} className="flex flex-col gap-[1.5vmin]">
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
            className={`${INPUT} text-center tabular-nums`}
          />
        </label>
      ))}
    </div>
  );
}

interface WeightFieldProps {
  readonly slot: DraftSlot;
  readonly onCommit: (weight: number | null) => void;
  readonly big?: boolean;
}

/** Re-keyed on the committed weight, so a swap that clears it empties the box. */
function WeightField(props: WeightFieldProps) {
  return <WeightInput key={props.slot.weight ?? "none"} {...props} />;
}

const asText = (weight: number | null) => (weight === null ? "" : String(weight));

function WeightInput({ slot, onCommit, big = false }: WeightFieldProps) {
  const [text, setText] = useState(asText(slot.weight));

  // Emptied is a choice: no weight, and the workout trains without one.
  const commit = () => {
    if (text.trim() === "") {
      onCommit(null);
      return;
    }
    const weight = Number(text.replace(",", "."));
    if (Number.isFinite(weight) && weight >= 0) onCommit(weight);
    else setText(asText(slot.weight));
  };

  const size = big
    ? "w-[4.5ch] text-[clamp(56px,16vmin,180px)]"
    : "w-[4ch] text-[clamp(36px,9vmin,96px)]";
  return (
    <label className="flex items-baseline gap-[2vmin]">
      <input
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        placeholder="—"
        inputMode="decimal"
        enterKeyHint="done"
        aria-label={`Your weight for ${slot.exercise.name}`}
        className={`${size} rounded-[3vmin] bg-white/10 px-[2vmin] py-[1vmin] text-center leading-none font-extrabold tabular-nums ring-[3px] ring-white/30 outline-none ring-inset placeholder:text-white/35 focus:ring-white`}
      />
      <span className="text-[clamp(24px,6vmin,64px)] font-extrabold opacity-70">kg</span>
    </label>
  );
}

/** Only an empty weight needs saying: it trains without one. */
function WeightNote({ slot }: { readonly slot: DraftSlot }) {
  if (slot.weight !== null) return null;
  return <p className={LABEL}>No weight · trains without one</p>;
}

interface SquareButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly label: string;
}

/** Not a circle: three circles won't fit in a slot row on an iPhone. */
function SquareButton({ label, className = "", ...props }: SquareButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      className={`flex size-[17vmin] max-h-[120px] min-h-[64px] max-w-[120px] min-w-[64px] flex-none items-center justify-center rounded-[3vmin] bg-white/15 text-[clamp(26px,7vmin,60px)] font-extrabold select-none active:scale-95 disabled:opacity-20 ${className}`}
      {...props}
    />
  );
}

function AddTile({ onPick }: Pick<EditorProps, "onPick">) {
  return (
    <button
      type="button"
      onClick={() => onPick({ kind: "add" })}
      className={`${WIDE} rounded-[4vmin] border-[3px] border-dashed border-white/30 p-[5vmin] text-[clamp(24px,6vmin,64px)] font-extrabold active:scale-[0.98]`}
    >
      ＋ Add exercise
    </button>
  );
}

function SaveRow({ isNew, onSave, onDelete }: Pick<EditorProps, "isNew" | "onSave" | "onDelete">) {
  return (
    <div className="flex flex-wrap justify-center gap-[4vmin]">
      <CircleButton onClick={onSave}>Save</CircleButton>
      {!isNew && (
        <CircleButton variant="outline" onClick={onDelete}>
          Delete
        </CircleButton>
      )}
    </div>
  );
}

const slotHandlers = (update: EditorProps["update"], index: number) => ({
  move: (by: -1 | 1) => update((draft) => moveSlot(draft, index, by)),
  remove: () => update((draft) => removeSlot(draft, index)),
  setWeight: (weight: number | null) => update((draft) => setWeight(draft, index, weight)),
});

// --- A · One page -----------------------------------------------------------

export function VariantA(props: EditorProps) {
  const { title, draft, update, onPick, onCancel, problem } = props;
  const last = draft.slots.length - 1;
  return (
    <Page title={title} onBack={onCancel}>
      <section className={`${WIDE} flex flex-col gap-[4vmin]`}>
        <NameField draft={draft} update={update} />
        <TimingFields draft={draft} update={update} />
      </section>
      <ol className={`${WIDE} flex flex-col gap-[4vmin]`}>
        {draft.slots.map((slot, index) => {
          const handle = slotHandlers(update, index);
          return (
            <li key={slot.key} className={`${CARD} flex flex-col gap-[3vmin]`}>
              <button
                type="button"
                onClick={() => onPick({ kind: "swap", index })}
                className="flex items-start gap-[3vmin] text-left"
              >
                <span className={`${NAME} opacity-40 tabular-nums`}>{index + 1}</span>
                <span className={`${NAME} min-w-0 flex-1`}>{slot.exercise.name}</span>
                <span className="text-[clamp(22px,5vmin,48px)] opacity-50">⇄</span>
              </button>
              <WeightField slot={slot} onCommit={handle.setWeight} />
              <WeightNote slot={slot} />
              <div className="flex gap-[3vmin]">
                <SquareButton label="Move up" disabled={index === 0} onClick={() => handle.move(-1)}>
                  ▲
                </SquareButton>
                <SquareButton label="Move down" disabled={index === last} onClick={() => handle.move(1)}>
                  ▼
                </SquareButton>
                <SquareButton label="Remove" className="ml-auto" onClick={handle.remove}>
                  ✕
                </SquareButton>
              </div>
            </li>
          );
        })}
      </ol>
      <AddTile onPick={onPick} />
      <Problem problem={problem} />
      <SaveRow {...props} />
    </Page>
  );
}

// --- B · Tap a slot -----------------------------------------------------------

type Focus = { readonly kind: "list" } | { readonly kind: "settings" } | { readonly kind: "slot"; readonly key: number };
const LIST: Focus = { kind: "list" };

export function VariantB(props: EditorProps) {
  const { title, draft, update, onPick, onCancel, problem } = props;
  const [focus, setFocus] = useState<Focus>(LIST);
  useEffect(() => {
    scrollTo(0, 0);
  }, [focus]);

  if (focus.kind === "settings") {
    return (
      <Page title="Routine" onBack={() => setFocus(LIST)}>
        <section className={`${WIDE} flex flex-col gap-[4vmin]`}>
          <NameField draft={draft} update={update} />
          <TimingFields draft={draft} update={update} />
        </section>
        <CircleButton onClick={() => setFocus(LIST)}>Done</CircleButton>
      </Page>
    );
  }

  const index = focus.kind === "slot" ? draft.slots.findIndex(({ key }) => key === focus.key) : -1;
  const slot = draft.slots[index];
  if (slot) {
    const handle = slotHandlers(update, index);
    return (
      <Page title={`Slot ${index + 1} of ${draft.slots.length}`} onBack={() => setFocus(LIST)}>
        <button
          type="button"
          onClick={() => onPick({ kind: "swap", index })}
          className={`${WIDE} ${CARD} flex flex-col items-center gap-[2vmin] active:scale-[0.98]`}
        >
          <span className="text-[clamp(36px,10vmin,120px)] leading-none font-extrabold break-words">
            {slot.exercise.name}
          </span>
          <span className={LABEL}>Tap to swap exercise</span>
        </button>
        <WeightField slot={slot} big onCommit={handle.setWeight} />
        <WeightNote slot={slot} />
        <div className="flex flex-wrap justify-center gap-[3vmin]">
          <CircleButton variant="outline" className="disabled:opacity-25" disabled={index === 0} onClick={() => handle.move(-1)}>
            Move up
          </CircleButton>
          <CircleButton
            variant="outline"
            className="disabled:opacity-25"
            disabled={index === draft.slots.length - 1}
            onClick={() => handle.move(1)}
          >
            Move down
          </CircleButton>
          <CircleButton
            variant="outline"
            onClick={() => {
              handle.remove();
              setFocus(LIST);
            }}
          >
            Remove
          </CircleButton>
          <CircleButton onClick={() => setFocus(LIST)}>Done</CircleButton>
        </div>
      </Page>
    );
  }

  return (
    <Page title={title} onBack={onCancel}>
      <button
        type="button"
        onClick={() => setFocus({ kind: "settings" })}
        className={`${WIDE} ${CARD} flex items-center gap-[4vmin] text-left active:scale-[0.98]`}
      >
        <span className="min-w-0 flex-1">
          <span className={`${NAME} block`}>{draft.name || "Untitled"}</span>
          <span className="mt-[1.5vmin] block text-[clamp(20px,4.6vmin,50px)] font-bold tabular-nums">
            {draft.rounds || "?"} rounds · {draft.work || "?"}/{draft.rest || "?"}
          </span>
        </span>
        <span className={`${NAME} opacity-40`}>›</span>
      </button>
      <ol className={`${WIDE} flex flex-col gap-[3vmin]`}>
        {draft.slots.map((each, position) => (
          <li key={each.key}>
            <button
              type="button"
              onClick={() => setFocus({ kind: "slot", key: each.key })}
              className={`${CARD} flex w-full items-center gap-[4vmin] text-left active:scale-[0.98]`}
            >
              <span className={`${NAME} opacity-40 tabular-nums`}>{position + 1}</span>
              <span className={`${NAME} min-w-0 flex-1`}>{each.exercise.name}</span>
              <span
                className={`text-[clamp(24px,6vmin,64px)] font-extrabold whitespace-nowrap tabular-nums ${each.weight === null ? "opacity-40" : ""}`}
              >
                {shownWeight(each.weight)}
              </span>
              <span className={`${NAME} opacity-40`}>›</span>
            </button>
          </li>
        ))}
      </ol>
      <AddTile onPick={onPick} />
      <Problem problem={problem} />
      <SaveRow {...props} />
    </Page>
  );
}

// --- C · Modes ----------------------------------------------------------------

const MODES = ["Weights", "Order", "Exercises", "Routine"] as const;
type Mode = (typeof MODES)[number];

export function VariantC(props: EditorProps) {
  const { title, draft, update, onPick, onCancel, onSave, onDelete, isNew, problem } = props;
  const [mode, setMode] = useState<Mode>(isNew ? "Routine" : "Weights");
  const last = draft.slots.length - 1;

  return (
    <Page title={title} onBack={onCancel}>
      <nav className={`${WIDE} grid grid-cols-2 gap-[2vmin] sm:grid-cols-4`}>
        {MODES.map((each) => (
          <button
            key={each}
            type="button"
            onClick={() => setMode(each)}
            className={`min-h-[64px] rounded-[3vmin] py-[3vmin] text-[clamp(18px,4.4vmin,40px)] font-extrabold tracking-[0.06em] uppercase active:scale-95 ${each === mode ? "bg-white text-black" : "bg-white/10"}`}
          >
            {each}
          </button>
        ))}
      </nav>

      {mode === "Routine" ? (
        <section className={`${WIDE} flex flex-col gap-[4vmin]`}>
          <NameField draft={draft} update={update} />
          <TimingFields draft={draft} update={update} />
          {!isNew && (
            <CircleButton variant="outline" className="self-center" onClick={onDelete}>
              Delete
            </CircleButton>
          )}
        </section>
      ) : (
        <ol className={`${WIDE} flex flex-col gap-[3vmin]`}>
          {draft.slots.map((slot, index) => {
            const handle = slotHandlers(update, index);
            const name = <span className={`${NAME} min-w-0 flex-1`}>{slot.exercise.name}</span>;
            return (
              <li key={slot.key} className={`${CARD} flex flex-wrap items-center gap-[3vmin]`}>
                {mode === "Weights" && (
                  <>
                    {name}
                    <WeightField slot={slot} onCommit={handle.setWeight} />
                    <div className="basis-full">
                      <WeightNote slot={slot} />
                    </div>
                  </>
                )}
                {mode === "Order" && (
                  <>
                    <SquareButton label="Move up" disabled={index === 0} onClick={() => handle.move(-1)}>
                      ▲
                    </SquareButton>
                    <span className="min-w-0 flex-1 text-center">
                      <span className={`${NAME} block`}>{slot.exercise.name}</span>
                      <span className={`${LABEL} mt-[1vmin] block`}>{shownWeight(slot.weight)}</span>
                    </span>
                    <SquareButton label="Move down" disabled={index === last} onClick={() => handle.move(1)}>
                      ▼
                    </SquareButton>
                  </>
                )}
                {mode === "Exercises" && (
                  <>
                    <button
                      type="button"
                      onClick={() => onPick({ kind: "swap", index })}
                      className="flex min-w-0 flex-1 items-center gap-[3vmin] text-left"
                    >
                      {name}
                      <span className="text-[clamp(22px,5vmin,48px)] opacity-50">⇄</span>
                    </button>
                    <SquareButton label="Remove" onClick={handle.remove}>
                      ✕
                    </SquareButton>
                  </>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {mode === "Exercises" && <AddTile onPick={onPick} />}
      <Problem problem={problem} />
      {/* Room for the pinned Save, so it never sits on the last row. */}
      <div className="h-[30vmin]" />
      <div
        className="fixed right-[5vmin] z-40"
        style={{ bottom: "calc(env(safe-area-inset-bottom) + 40px)" }}
      >
        <CircleButton className="shadow-2xl" onClick={onSave}>
          Save
        </CircleButton>
      </div>
    </Page>
  );
}
