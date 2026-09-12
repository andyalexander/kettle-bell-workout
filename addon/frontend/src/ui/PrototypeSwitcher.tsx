// PROTOTYPE (#48), throwaway: the yellow dev-only bar that flips `?variant=`,
// as on `prototype/picker-room`. Never merge it to main.
import type { ReactNode } from "react";
import { useEffect, useSyncExternalStore } from "react";

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

const readParam = () => new URLSearchParams(location.search).get("variant");

function setVariant(variant: string) {
  const url = new URL(location.href);
  url.searchParams.set("variant", variant);
  history.replaceState(null, "", url);
  listeners.forEach((listener) => listener());
}

/** The current `?variant=`, or the first key when it names none of them. */
export function useVariant<K extends string>(keys: readonly K[]): K {
  const value = useSyncExternalStore(subscribe, readParam);
  return keys.find((key) => key === value) ?? (keys[0] as K);
}

interface PrototypeSwitcherProps<K extends string> {
  readonly variants: Readonly<Record<K, string>>;
  /** The state worth seeing after every change, shown in the bar. */
  readonly children?: ReactNode;
}

export function PrototypeSwitcher<K extends string>({
  variants,
  children,
}: PrototypeSwitcherProps<K>) {
  const keys = Object.keys(variants) as K[];
  const variant = useVariant(keys);

  const step = (by: number) =>
    setVariant(keys[(keys.indexOf(variant) + by + keys.length) % keys.length] ?? variant);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest("input, textarea, [contenteditable]")) return;
      if (event.key === "ArrowLeft") step(-1);
      if (event.key === "ArrowRight") step(1);
    };
    addEventListener("keydown", handleKey);
    return () => removeEventListener("keydown", handleKey);
  });

  if (!import.meta.env.DEV) return null;

  // Inside the home-indicator inset, so it never covers any variant's content.
  return (
    <div className="fixed inset-x-0 bottom-[4px] z-50 flex justify-center">
      <div className="flex h-[30px] items-center gap-2 rounded-full bg-yellow-300 px-1 text-[13px] font-bold text-black shadow-lg">
        <button className="px-3" onClick={() => step(-1)} aria-label="Previous variant">
          ◀
        </button>
        <span className="whitespace-nowrap">
          {variant} · {variants[variant]}
          {children && <> · {children}</>}
        </span>
        <button className="px-3" onClick={() => step(1)} aria-label="Next variant">
          ▶
        </button>
      </div>
    </div>
  );
}
