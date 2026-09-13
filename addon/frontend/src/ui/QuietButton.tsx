import type { ButtonHTMLAttributes } from "react";

/**
 * A rare action as a small, quiet pill: Edit, ＋ New routine, ＋ Add exercise,
 * ＋ New exercise (#48). It never competes with the circle beside it.
 */
export function QuietButton({
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={`min-h-[48px] rounded-full px-[5vmin] py-[2vmin] text-[clamp(14px,3vmin,24px)] font-bold tracking-[0.06em] uppercase opacity-60 ring-2 ring-white/30 select-none ring-inset active:scale-95 disabled:opacity-25 ${className}`}
      {...props}
    />
  );
}
