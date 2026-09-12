// PROTOTYPE (#35), throwaway: where should the screens before a workout sit
// vertically on the iPhone? Four variants of `Page`, switched by `?variant=` and
// the yellow bar at the very bottom. Judge them as a Home Screen app, where the
// status bar is translucent. Delete once one has won; fold it into `Page`.
import { useEffect, useState, useSyncExternalStore } from "react";

export const PAGE_VARIANTS = {
  A: "As now",
  B: "Pushed down",
  C: "Centred",
  D: "Thumb reach",
} as const;

export type PageVariant = keyof typeof PAGE_VARIANTS;

const KEYS = Object.keys(PAGE_VARIANTS) as PageVariant[];
const listeners = new Set<() => void>();

function readVariant(): PageVariant {
  const value = new URLSearchParams(location.search).get("variant");
  return KEYS.find((key) => key === value) ?? "A";
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

function setVariant(variant: PageVariant) {
  const url = new URL(location.href);
  url.searchParams.set("variant", variant);
  history.replaceState(null, "", url);
  listeners.forEach((listener) => listener());
}

export function usePageVariant(): PageVariant {
  return useSyncExternalStore(subscribe, readVariant);
}

/** What the phone actually does: the top inset, and where the title lands. */
function useMeasurements(variant: PageVariant) {
  const [text, setText] = useState("");

  useEffect(() => {
    const measure = () => {
      const probe = document.createElement("div");
      probe.style.paddingTop = "env(safe-area-inset-top)";
      document.body.append(probe);
      const inset = parseFloat(getComputedStyle(probe).paddingTop);
      probe.remove();
      const title = document.querySelector("main h1")?.getBoundingClientRect();
      const tiles = document.querySelector("main ul")?.getBoundingClientRect();
      setText(
        `inset ${inset} · title ${title ? Math.round(title.top) : "–"}` +
          ` · list ${tiles ? Math.round(tiles.top) : "–"}/${innerHeight}`,
      );
    };
    // Polled, not measured once: the picker replaces the loading page later.
    const timer = setInterval(measure, 500);
    return () => clearInterval(timer);
  }, [variant]);

  return text;
}

export function PrototypeSwitcher() {
  const variant = usePageVariant();
  const measurements = useMeasurements(variant);

  const step = (by: number) =>
    setVariant(KEYS[(KEYS.indexOf(variant) + by + KEYS.length) % KEYS.length] ?? "A");

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
          {variant} · {PAGE_VARIANTS[variant]} · {measurements}
        </span>
        <button className="px-3" onClick={() => step(1)} aria-label="Next variant">
          ▶
        </button>
      </div>
    </div>
  );
}
