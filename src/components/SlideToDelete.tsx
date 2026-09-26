import { useRef, useState } from 'react';

/**
 * Delete, confirmed by sliding rather than tapping.
 *
 * A finger has no hover and no right-click, so on a touchscreen the whole of
 * deletion has to happen in one press. That makes an ordinary "Delete" button
 * dangerous: the same gesture that opened the sheet would destroy a panel if
 * it landed a few pixels further down. A slide cannot be produced by accident,
 * so the confirmation is the gesture itself - no second dialog asking whether
 * you meant it.
 */
export function SlideToDelete({
  label,
  onConfirm,
  onCancel,
}: {
  label: string;
  onConfirm(): void;
  onCancel(): void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(0);
  const dragging = useRef(false);

  const KNOB_PX = 56;
  /** Far enough that a stray swipe cannot reach it, short enough to be easy. */
  const COMMIT_AT = 0.92;

  const travel = () => {
    const track = trackRef.current;
    return track ? Math.max(1, track.clientWidth - KNOB_PX) : 1;
  };

  const start = (e: React.PointerEvent) => {
    dragging.current = true;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Already released; the slide still works without capture.
    }
  };

  const move = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    const track = trackRef.current;
    if (!track) return;
    const left = track.getBoundingClientRect().left;
    const next = Math.min(1, Math.max(0, (e.clientX - left - KNOB_PX / 2) / travel()));
    setProgress(next);
    if (next >= COMMIT_AT) {
      dragging.current = false;
      setProgress(1);
      onConfirm();
    }
  };

  const release = () => {
    if (!dragging.current) return;
    dragging.current = false;
    // Springs back rather than staying part-way, so a hesitant swipe reads as
    // "nothing happened" instead of "something is half done".
    setProgress(0);
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium text-slate-800">{label}</p>
      <div
        ref={trackRef}
        className="relative h-14 select-none overflow-hidden rounded-full border border-red-200 bg-red-50"
        style={{ touchAction: 'none' }}
      >
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center pr-6 text-sm font-medium text-red-700">
          Slide to delete
        </span>
        <div
          role="slider"
          aria-label="Slide to delete"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
          tabIndex={0}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={release}
          onPointerCancel={release}
          // A keyboard cannot slide, so Enter on the focused control deletes.
          // The gesture guards against a stray finger, not against intent.
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onConfirm();
            }
          }}
          className="absolute top-1 flex h-12 w-14 items-center justify-center rounded-full bg-red-600 text-white shadow-sm"
          style={{
            left: 4,
            transform: `translateX(${progress * travel()}px)`,
            transition: dragging.current ? 'none' : 'transform 150ms ease-out',
          }}
        >
          <span aria-hidden className="text-lg leading-none">
            &#8594;
          </span>
        </div>
      </div>
      <button
        type="button"
        onClick={onCancel}
        className="min-h-11 rounded-md border border-slate-300 bg-white text-sm font-medium text-slate-700"
      >
        Cancel
      </button>
    </div>
  );
}
