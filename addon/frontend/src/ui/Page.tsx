import type { ReactNode } from "react";

import { CircleButton } from "./CircleButton";

interface PageProps {
  readonly title: string;
  /** Shows a Back circle beside the title. */
  readonly onBack?: () => void;
  readonly children?: ReactNode;
}

/**
 * The shell of every screen before the workout: dim ground, one big title.
 * The top padding clears the translucent status bar with room to spare, judged
 * on the iPhone as a Home Screen app (#35).
 */
export function Page({ title, onBack, children }: PageProps) {
  return (
    <main
      className="flex min-h-dvh flex-col bg-ground text-white"
      style={{
        padding:
          "env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)",
      }}
    >
      {/* Fills the screen, so a child with `mt-auto` sits at the very bottom. */}
      <div className="flex flex-1 flex-col items-center gap-[7vmin] px-[5vmin] pt-[16vmin] pb-[8vmin]">
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
