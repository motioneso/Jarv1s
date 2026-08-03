import { useEffect, useRef, useState } from "react";

/**
 * Auto-advance + pause behaviour shared by the two hero carousels: the top-stories carousel
 * (HeroCarousel) and the gameday score bar (#1386). Only the timer and the pause rules live
 * here — each carousel keeps its own notion of "which slide", because they differ: the story
 * carousel indexes by position, the gameday one tracks the game id so a refetch that reorders
 * or drops a game can't swap what you're reading.
 *
 * Pausing on focus as well as hover is the accessibility half: a keyboard user tabbing into
 * the controls would otherwise have the slide move out from under them mid-interaction.
 *
 * `advance` is held in a ref rather than listed as an effect dependency — a caller that
 * rebuilds the callback each render would otherwise reset the interval every render, and the
 * slide would never advance at all.
 */
export function useAutoAdvance(
  count: number,
  advance: () => void,
  intervalMs: number
): {
  readonly onMouseEnter: () => void;
  readonly onMouseLeave: () => void;
  readonly onFocus: () => void;
  readonly onBlur: () => void;
} {
  const [paused, setPaused] = useState(false);
  const advanceRef = useRef(advance);

  useEffect(() => {
    advanceRef.current = advance;
  }, [advance]);

  useEffect(() => {
    if (paused || count < 2) return;
    // Auto-advancing carousels are a classic reduced-motion offender; honour the OS setting and
    // leave the reader on whichever slide they're on, reachable by the controls.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => advanceRef.current(), intervalMs);
    return () => window.clearInterval(timer);
  }, [paused, count, intervalMs]);

  return {
    onMouseEnter: () => setPaused(true),
    onMouseLeave: () => setPaused(false),
    onFocus: () => setPaused(true),
    onBlur: () => setPaused(false)
  };
}
