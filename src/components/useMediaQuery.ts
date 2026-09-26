import { useEffect, useState } from 'react';

/**
 * A live `matchMedia` result.
 *
 * Reactive rather than read once, because these genuinely change under the
 * app: a tablet rotates, a window is dragged between monitors, and a hybrid
 * laptop switches from trackpad to touchscreen mid-session.
 *
 * Guarded for environments without `matchMedia` - jsdom in the test suite has
 * it, but a server render would not.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);

  return matches;
}

/**
 * True when the primary pointer is a finger rather than a mouse.
 *
 * This is what decides the gesture model, not the screen width: a drag means
 * "pan" to a finger and "draw a selection box" to a mouse, and a 13-inch
 * tablet and a 13-inch laptop want opposite answers at the same width.
 */
export function useCoarsePointer(): boolean {
  return useMediaQuery('(pointer: coarse)');
}

/**
 * True below Tailwind's `lg`, which is where the desktop three-column layout
 * stops fitting and the rails move into the bottom sheet.
 */
export function useCompactLayout(): boolean {
  return useMediaQuery('(max-width: 1023.98px)');
}

/** True below Tailwind's `sm` - phone width, where drawing is not the point. */
export function usePhoneLayout(): boolean {
  return useMediaQuery('(max-width: 639.98px)');
}
