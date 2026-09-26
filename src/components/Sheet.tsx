import { useEffect, useRef, useState } from 'react';
import { LeftRail } from './LeftRail';
import { RightRail } from './RightRail';
import { formatCurrency } from '../core/pricing';
import { useStore } from '../state/store';
import type { Bom, ValidationResult } from '../core/types';

type Tab = 'tools' | 'layers' | 'materials';
type Snap = 'peek' | 'half' | 'full';

/** How much of the screen the sheet covers at each snap. */
const HEIGHT: Record<Snap, string> = {
  peek: '0px',
  half: 'min(52svh, 520px)',
  full: 'min(88svh, 860px)',
};

interface Props {
  bom: Bom;
  validation: ValidationResult;
  onEditPlot(): void;
  onEditUnderlay(): void;
  onEditPricing(): void;
  /** Phones open on the materials, where the answer is; tablets open on tools. */
  initialTab: Tab;
  /**
   * Whether the sheet starts open. A tablet is for drawing, so its tools
   * should be on screen rather than behind a tap nobody knows to make. A
   * phone is for reading the plan, so the drawing keeps the screen and the
   * handle carries the two figures that matter.
   */
  initiallyOpen: boolean;
}

/**
 * The rails, on a screen too narrow to stand them beside the drawing.
 *
 * A sheet rather than a third column or a stack: the drawing keeps the screen,
 * and what you came for - is it buildable, what does it cost - is on the
 * handle itself, so the common case needs no tap at all.
 *
 * The panes are the real `LeftRail` and `RightRail`, not copies. There is one
 * definition of each control, and a change to the desktop rail reaches the
 * phone by construction.
 */
export function Sheet({
  bom,
  validation,
  onEditPlot,
  onEditUnderlay,
  onEditPricing,
  initialTab,
  initiallyOpen,
}: Props) {
  const [snap, setSnap] = useState<Snap>(initiallyOpen ? 'half' : 'peek');
  const [tab, setTab] = useState<Tab>(initialTab);
  const role = useStore((s) => s.role);
  const drag = useRef<{ y: number; from: Snap } | null>(null);

  // A client has no drawing tools, so those tabs would open on nothing.
  const tabs: Array<{ id: Tab; label: string }> =
    role === 'client'
      ? [
          { id: 'layers', label: 'Layers' },
          { id: 'materials', label: 'Materials' },
        ]
      : [
          { id: 'tools', label: 'Tools' },
          { id: 'layers', label: 'Layers' },
          { id: 'materials', label: 'Materials' },
        ];

  useEffect(() => {
    if (!tabs.some((t) => t.id === tab)) setTab(tabs[0].id);
  }, [role]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = (next: Tab) => {
    setTab(next);
    setSnap((current) => (current === 'peek' ? 'half' : current));
  };

  /**
   * Drag the handle to move a snap, or tap it to open and close.
   *
   * Both decided on pointerup rather than leaving the tap to a `click`: the
   * handle captures the pointer so a drag that wanders off it still lands, and
   * a captured pointer never produces a click on anything inside.
   */
  const SNAPS: Snap[] = ['peek', 'half', 'full'];
  const TAP_SLOP_PX = 24;

  const onHandleDown = (e: React.PointerEvent) => {
    drag.current = { y: e.clientY, from: snap };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Already released; the gesture still works without capture.
    }
  };

  const onHandleUp = (e: React.PointerEvent) => {
    const start = drag.current;
    drag.current = null;
    if (!start) return;

    const travelled = start.y - e.clientY;
    if (Math.abs(travelled) < TAP_SLOP_PX) {
      setSnap(start.from === 'peek' ? 'half' : 'peek');
      return;
    }
    const at = SNAPS.indexOf(start.from);
    setSnap(SNAPS[travelled > 0 ? Math.min(2, at + 1) : Math.max(0, at - 1)]);
  };

  const onHandleCancel = () => {
    drag.current = null;
  };

  const blocking = validation.errors.length;

  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex flex-col lg:hidden"
      // The handle must clear the home indicator on a phone.
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      {/* The handle: the status and the total, always readable, never covering
          more than a strip of the drawing. */}
      <div className="pointer-events-auto border-t border-slate-200 bg-white/95 backdrop-blur">
        <button
          type="button"
          onPointerDown={onHandleDown}
          onPointerUp={onHandleUp}
          onPointerCancel={onHandleCancel}
          aria-expanded={snap !== 'peek'}
          aria-label={snap === 'peek' ? 'Open the panels' : 'Close the panels'}
          className="flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left"
          style={{ touchAction: 'none' }}
        >
          <span className="flex flex-col items-center gap-1 text-slate-400">
            <span className="h-1 w-8 rounded-full bg-slate-300" />
          </span>
          <span
            className={`rounded px-2 py-0.5 text-xs font-semibold ${
              validation.manufacturable
                ? 'bg-emerald-50 text-emerald-700'
                : blocking > 0
                  ? 'bg-red-50 text-red-700'
                  : 'bg-slate-100 text-slate-600'
            }`}
          >
            {validation.manufacturable
              ? 'Manufacturable'
              : blocking > 0
                ? `${blocking} to fix`
                : 'Nothing built'}
          </span>
          <span className="ml-auto text-sm font-semibold tabular-nums text-slate-900">
            {formatCurrency(bom.cost.total)}
          </span>
        </button>
      </div>

      {/* The panes. Height rather than transform, so the drawing above keeps
          its own scroll and the sheet never covers the whole screen. */}
      <div
        className="pointer-events-auto overflow-hidden bg-white transition-[height] duration-200 ease-out motion-reduce:transition-none"
        style={{ height: HEIGHT[snap] }}
      >
        <div className="flex h-full flex-col">
          <div className="flex shrink-0 gap-1 border-b border-slate-200 px-2 py-1.5">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => open(t.id)}
                aria-pressed={tab === t.id}
                className={`min-h-10 flex-1 rounded px-3 py-1.5 text-sm font-medium transition ${
                  tab === t.id ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {t.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setSnap(snap === 'full' ? 'half' : 'full')}
              aria-label={snap === 'full' ? 'Shrink the panel' : 'Expand the panel'}
              className="min-h-10 rounded px-3 text-slate-500 hover:bg-slate-100"
            >
              {snap === 'full' ? '⌄' : '⌃'}
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {tab === 'materials' ? (
              <RightRail bom={bom} validation={validation} onEditPricing={onEditPricing} />
            ) : (
              <LeftRail
                onEditPlot={onEditPlot}
                onEditUnderlay={onEditUnderlay}
                only={tab === 'layers' ? 'layers' : 'draw'}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
