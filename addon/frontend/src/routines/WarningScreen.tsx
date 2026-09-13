import { CircleButton } from "../ui/CircleButton";
import { Page } from "../ui/Page";

interface WarningScreenProps {
  readonly title: string;
  readonly lines: readonly string[];
  /** The risky choice: Save anyway, Delete. */
  readonly confirmLabel: string;
  /** The safe choice's label; Keep editing where Go back would read as leaving. */
  readonly backLabel?: string;
  /** A call is on its way; neither choice can be made twice. */
  readonly busy: boolean;
  readonly problem: string | null;
  readonly onConfirm: () => void;
  readonly onBack: () => void;
}

/** The ⚠️, in-app and never a browser dialog; Go back leads, as abort's safe choice does (#4). */
export function WarningScreen({
  title,
  lines,
  confirmLabel,
  backLabel = "Go back",
  busy,
  problem,
  onConfirm,
  onBack,
}: WarningScreenProps) {
  return (
    <Page title={title}>
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
      {problem && (
        <p
          role="alert"
          className="text-center text-[clamp(18px,4vmin,42px)] font-semibold text-red-300"
        >
          {problem}
        </p>
      )}
      <div className="flex flex-wrap justify-center gap-[4vmin]">
        <CircleButton disabled={busy} onClick={onBack}>
          {backLabel}
        </CircleButton>
        <CircleButton variant="outline" disabled={busy} onClick={onConfirm}>
          {busy ? "…" : confirmLabel}
        </CircleButton>
      </div>
    </Page>
  );
}
