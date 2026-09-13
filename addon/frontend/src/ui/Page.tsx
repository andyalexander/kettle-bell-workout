import type { ReactNode } from "react";

import { CircleButton } from "./CircleButton";

interface PageProps {
  readonly title: string;
  /** Shows a Back circle beside the title. */
  readonly onBack?: () => void;
  /** The screen's one action, as a circle on the header's right: Save in the editor (#48). */
  readonly action?: ReactNode;
  readonly children?: ReactNode;
}

/**
 * The shell of every screen before the workout: dim ground, one big title.
 * The top padding clears the translucent status bar with room to spare, judged
 * on the iPhone as a Home Screen app (#35).
 */
export function Page({ title, onBack, action, children }: PageProps) {
  // Between two circles the title keeps a third of a phone's width, so it steps
  // down a size and the gaps tighten; it still wraps between words, never mid-word.
  const titleSize = action ? "text-[clamp(24px,6vmin,72px)]" : "text-[clamp(34px,8vmin,96px)]";
  const gap = action ? "gap-[3vmin]" : "gap-[4vmin]";
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
        <header className={`flex w-full max-w-[1100px] items-center justify-center ${gap}`}>
          {onBack && (
            <CircleButton variant="outline" onClick={onBack}>
              Back
            </CircleButton>
          )}
          <h1
            className={`min-w-0 flex-1 ${titleSize} leading-none font-extrabold tracking-[-0.02em] break-words ${onBack ? "text-left" : "text-center"}`}
          >
            {title}
          </h1>
          {action}
        </header>
        {children}
      </div>
    </main>
  );
}
