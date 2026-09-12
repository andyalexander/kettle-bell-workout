import type { ButtonHTMLAttributes } from "react";

/**
 * - `solid`: the action to take — resume, keep going, done.
 * - `outline`: the one to think twice about — abort.
 * - `tinted`: a control sitting on a phase colour mid-workout.
 */
export type CircleVariant = "solid" | "outline" | "tinted";

const VARIANTS: Readonly<Record<CircleVariant, string>> = {
  solid: "bg-white text-black",
  outline: "bg-transparent text-white ring-[3px] ring-white/50 ring-inset",
  tinted: "bg-black/30 text-white",
};

interface CircleButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: CircleVariant;
}

/**
 * The one button shape in the app (issue #4): a large circle, hard to miss with
 * a chalky thumb from across a room.
 */
export function CircleButton({
  variant = "solid",
  className = "",
  type = "button",
  ...props
}: CircleButtonProps) {
  return (
    <button
      type={type}
      className={`flex size-[28vmin] max-h-[200px] min-h-[110px] max-w-[200px] min-w-[110px] flex-none items-center justify-center rounded-full p-[2vmin] text-[clamp(16px,3.4vmin,32px)] leading-tight font-extrabold tracking-[0.08em] uppercase select-none active:scale-95 ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}
