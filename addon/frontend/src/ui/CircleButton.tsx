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

/**
 * - `large`: the default — every action and choice.
 * - `small`: a rarely touched toggle that shouldn't compete with them — sound.
 */
export type CircleSize = "large" | "small";

const SIZES: Readonly<Record<CircleSize, string>> = {
  large: "size-[28vmin] max-h-[200px] min-h-[110px] max-w-[200px] min-w-[110px]",
  small: "size-[14vmin] max-h-[100px] min-h-[64px] max-w-[100px] min-w-[64px]",
};

interface CircleButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: CircleVariant;
  readonly size?: CircleSize;
}

/**
 * The one button shape in the app (issue #4): a large circle, hard to miss with
 * a chalky thumb from across a room.
 */
export function CircleButton({
  variant = "solid",
  size = "large",
  className = "",
  type = "button",
  ...props
}: CircleButtonProps) {
  return (
    <button
      type={type}
      className={`flex flex-none items-center justify-center rounded-full p-[2vmin] text-[clamp(16px,3.4vmin,32px)] leading-tight font-extrabold tracking-[0.08em] uppercase select-none active:scale-95 ${SIZES[size]} ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}
