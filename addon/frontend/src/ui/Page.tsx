import type { ReactNode } from "react";

import { CircleButton } from "./CircleButton";

interface PageProps {
  readonly title: string;
  /** Shows a Back circle beside the title. */
  readonly onBack?: () => void;
  readonly children: ReactNode;
}

/** The shell of every screen before the workout: dim ground, one big title. */
export function Page({ title, onBack, children }: PageProps) {
  return (
    <main
      className="min-h-dvh bg-ground text-white"
      style={{
        padding:
          "env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)",
      }}
    >
      <div className="flex flex-col items-center gap-[5vmin] px-[5vmin] pt-[6vmin] pb-[8vmin]">
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
