import type { RefObject } from "react";
import { useLayoutEffect, useRef } from "react";

/** The smallest the text may shrink to, as a fraction of its CSS size. */
const FLOOR = 0.6;
const STEP = 0.04;

/**
 * Cap text at `maxLines` by shrinking it, never by truncating: an ellipsised
 * exercise name is unreadable at training distance (issue #4). The font steps
 * down from its CSS size to a floor of 60%; only a name too long even for the
 * floor meets the element's CSS line-clamp.
 *
 * Unlike the prototype, the limit is measured at the size being tried, so three
 * shrunken lines can never pass for two.
 */
export function useShrinkToFit<T extends HTMLElement>(
  text: string,
  maxLines = 2,
): RefObject<T | null> {
  const ref = useRef<T>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    const fit = () => {
      element.style.fontSize = "";
      const style = getComputedStyle(element);
      const base = parseFloat(style.fontSize);
      const lineRatio = parseFloat(style.lineHeight) / base || 1;
      const overflows = (size: number) =>
        element.scrollHeight > lineRatio * size * maxLines + 2;

      let size = base;
      while (overflows(size) && size > base * FLOOR) {
        size -= base * STEP;
        element.style.fontSize = `${size}px`;
      }
    };

    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [text, maxLines]);

  return ref;
}
