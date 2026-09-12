import type { ReactNode } from "react";

import { CircleButton } from "./CircleButton";
import type { PageVariant } from "./PagePrototype";
import { usePageVariant } from "./PagePrototype";

interface PageProps {
  readonly title: string;
  /** Shows a Back circle beside the title. */
  readonly onBack?: () => void;
  readonly children?: ReactNode;
}

/** The shell of every screen before the workout: dim ground, one big title. */
// PROTOTYPE (#35): how the column sits in the screen, per variant.
const LAYOUT: Readonly<Record<PageVariant, string>> = {
  A: "pt-[6vmin]",
  B: "pt-[16vmin]",
  C: "justify-center pt-[6vmin]",
  D: "justify-between pt-[16vmin]",
};

export function Page({ title, onBack, children }: PageProps) {
  const variant = usePageVariant();
  return (
    <main
      className="flex min-h-dvh flex-col bg-ground text-white"
      style={{
        padding:
          "env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)",
      }}
    >
      <div
        className={`flex flex-1 flex-col items-center gap-[5vmin] px-[5vmin] pb-[8vmin] ${LAYOUT[variant]}`}
      >
        <header className="flex w-full max-w-[1100px] items-center justify-center gap-[4vmin]">
          {onBack && (
            <CircleButton variant="outline" onClick={onBack}>
              Back
            </CircleButton>
          )}
          <h1
            className={`min-w-0 flex-1 text-[clamp(34px,8vmin,96px)] leading-none font-extrabold tracking-[-0.02em] break-words ${onBack ? "text-left" : "text-center"}`}
          >
            {title}
          </h1>
        </header>
        {children}
      </div>
    </main>
  );
}
