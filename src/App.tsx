import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type Konva from 'konva';
import { DesignCanvas } from './canvas/DesignCanvas';
import { LeftRail } from './components/LeftRail';
import { RightRail } from './components/RightRail';
import { TopBar } from './components/TopBar';
import type { ExportActions } from './components/TopBar';
import { PlansDialog } from './components/PlansDialog';
import { PlotDialog } from './components/PlotDialog';
import { PricingDialog } from './components/PricingDialog';
import { UnderlayDialog } from './components/UnderlayDialog';
import { CalibrationBanner } from './components/CalibrationBanner';
import { Sheet } from './components/Sheet';
import { useCompactLayout, usePhoneLayout } from './components/useMediaQuery';
import { buildBom } from './core/bom';
import { EXPORT_HIDDEN, PX_PER_UNIT, planBoundsUnits } from './canvas/view';
import { serializePlan } from './core/plan';
import { validatePlan } from './core/validation';
import { plotAreaSqFt } from './core/plot';
import { footprintAreaSqFt, interiorCells } from './core/footprint';
import { toWorkOrder } from './core/workorder';
import { bomToCsv } from './export/csv';
import {
  copyText,
  downloadBlob,
  downloadDataUrl,
  downloadsAreBlocked,
  slugify,
} from './export/download';
import { useStore } from './state/store';

type Dialog = 'plot' | 'pricing' | 'plans' | 'underlay' | null;
type View = 'plan' | '3d';

// Three is a large dependency and only the 3D tab needs it, so it loads on
// demand rather than on first paint - the same split the quote PDF uses.
const ThreeView = lazy(() => import('./three/ThreeView'));

/** Target long edge, in pixels, for the plan image embedded in exports. */
const EXPORT_LONG_EDGE_PX = 1800;

export default function App() {
  const stageRef = useRef<Konva.Stage | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [view, setView] = useState<View>('plan');

  const plan = useStore((s) => s.plan);
  const priceConfig = useStore((s) => s.priceConfig);
  const role = useStore((s) => s.role);
  const message = useStore((s) => s.message);
  const clearMessage = useStore((s) => s.clearMessage);
  const notify = useStore((s) => s.notify);
  const refreshSavedPlans = useStore((s) => s.refreshSavedPlans);
  const unit = useStore((s) => s.unit);
  const compact = useCompactLayout();
  const phone = usePhoneLayout();

  const validation = useMemo(
    () => validatePlan(plan.panels, plan.plot, unit),
    [plan.panels, plan.plot, unit],
  );
  const bom = useMemo(() => buildBom(plan.panels, priceConfig), [plan.panels, priceConfig]);

  // Both views show these, so the flood fill runs once per change rather than
  // once per view. `interiorCells` walks the whole wall bounding box.
  const areas = useMemo(
    () => ({
      plotSqFt: plotAreaSqFt(plan.plot),
      floorSqFt: footprintAreaSqFt(interiorCells(plan.panels)),
    }),
    [plan.plot, plan.panels],
  );

  useEffect(() => {
    refreshSavedPlans();
  }, [refreshSavedPlans]);

  // Transient toasts clear themselves; errors linger long enough to read.
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(clearMessage, message.tone === 'error' ? 5000 : 3000);
    return () => clearTimeout(timer);
  }, [message, clearMessage]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)
      ) {
        return;
      }
      const state = useStore.getState();
      if (state.role === 'client') return;

      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) state.redo();
        else state.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        state.redo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        state.duplicateSelection();
        return;
      }
      if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        state.selectAll();
        return;
      }
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        state.saveVersion();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        state.deleteSelection();
        return;
      }
      if (e.key === 'Escape') {
        state.setWallAnchor(null);
        state.clearSelection();
        return;
      }
      if (e.key.toLowerCase() === 'r') {
        if (state.selection.length > 0) state.rotateSelection();
        else state.rotateBrush();
        return;
      }
      const nudge: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      };
      if (nudge[e.key]) {
        if (state.selection.length === 0) return;
        // Claim the key only when something is selected, so arrow keys still
        // scroll the rails when nothing is picked.
        e.preventDefault();
        const [dx, dy] = nudge[e.key];
        state.nudgeSelection(dx, dy);
        return;
      }
      if (e.key === '1') state.setTool('wall');
      if (e.key === '2') state.setTool('panel');
      if (e.key === '3') state.setTool('select');
      if (e.key === '4') state.setTool('room');
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  /**
   * Snapshot the drawing at 2x so it stays legible in print, cropped to the
   * content rather than the whole viewport - a full-canvas capture is mostly
   * empty paper and bloats the PDF by an order of magnitude.
   */
  const capturePlanImage = useCallback((): string | null => {
    const stage = stageRef.current;
    if (!stage) return null;

    // The grid is culled to the visible region, so it would cover only part of
    // any other framing. Hidden for the capture and restored in `finally`.
    const hidden = stage.find(`.${EXPORT_HIDDEN}`);
    try {
      // Frame the drawing, not the viewport. Crop in screen space at the
      // stage's *current* transform rather than moving the camera: every
      // stroke width and label size in the scene is compensated for that
      // scale, so capturing at a different one would render them wrong.
      //
      // Nothing here is clamped to the stage size, and that matters twice
      // over. Clamping is what made the old crop collapse to the whole
      // viewport - the opaque backdrop spans +/-100000, so `getClientRect`
      // returned a rect far larger than the stage and the clamp handed back
      // the entire pane, empty plot and all. It also means the capture works
      // while the plan tab is hidden, where the pane measures zero and the
      // stage shrinks to its 320x240 minimum; Konva re-renders the scene
      // graph into a canvas of whatever size we ask for.
      const box = planBoundsUnits(plan.plot, plan.panels);
      const scale = stage.scaleX() || 1;
      const width = (box.maxX - box.minX) * PX_PER_UNIT * scale;
      const height = (box.maxY - box.minY) * PX_PER_UNIT * scale;
      if (!(width > 1 && height > 1)) return null;

      // Zoomed out, that region can be only a few hundred pixels across, so
      // resolution comes from the pixel ratio. It scales everything equally,
      // which is why it cannot distort the drawing the way rescaling would.
      const pixelRatio = Math.min(6, Math.max(1, EXPORT_LONG_EDGE_PX / Math.max(width, height)));

      hidden.forEach((node) => node.visible(false));
      return stage.toDataURL({
        x: box.minX * PX_PER_UNIT * scale + stage.x(),
        y: box.minY * PX_PER_UNIT * scale + stage.y(),
        width,
        height,
        pixelRatio,
      });
    } catch (error) {
      console.warn('Could not capture the plan drawing.', error);
      return null;
    } finally {
      hidden.forEach((node) => node.visible(true));
      stage.batchDraw();
    }
  }, [plan.plot, plan.panels]);

  /**
   * Hand a text export to the user by whichever route the host allows: a file
   * when the page can save one, the clipboard when it is embedded and the
   * sandbox blocks downloads. Either way the control reports what happened
   * instead of appearing to do nothing.
   */
  const deliverText = useCallback(
    async (label: string, text: string, filename: string, mime: string) => {
      if (!downloadsAreBlocked()) {
        downloadBlob(new Blob([text], { type: mime }), filename);
        return;
      }
      const copied = await copyText(text);
      notify(
        copied
          ? `${label} copied to the clipboard. This embedded view cannot save files.`
          : `${label} could not be saved: this embedded view blocks downloads and clipboard access. Open the app in its own tab.`,
        copied ? 'info' : 'error',
      );
    },
    [notify],
  );

  const exports: ExportActions = useMemo(
    () => ({
      png() {
        const image = capturePlanImage();
        if (!image) {
          notify('The drawing could not be captured.', 'error');
          return;
        }
        if (downloadsAreBlocked()) {
          notify('This embedded view cannot save images. Open the app in its own tab.', 'error');
          return;
        }
        downloadDataUrl(image, `${slugify(plan.name)}-plan.png`);
      },
      async pdf() {
        if (downloadsAreBlocked()) {
          notify(
            'This embedded view cannot save PDFs. Open the app in its own tab, or export the BOM as CSV.',
            'error',
          );
          return;
        }
        // jsPDF is a third of the bundle and only the quote needs it, so it
        // loads on demand rather than on first paint.
        const planImage = capturePlanImage();
        try {
          const { buildQuotePdf } = await import('./export/pdf');
          buildQuotePdf({ plan, bom, priceConfig, validation, planImage, unit }).save(
            `${slugify(plan.name)}-quote.pdf`,
          );
        } catch (error) {
          console.error(error);
          notify('The quote PDF could not be generated.', 'error');
        }
      },
      csv() {
        void deliverText(
          'BOM CSV',
          bomToCsv(plan, bom, unit),
          `${slugify(plan.name)}-bom.csv`,
          'text/csv;charset=utf-8',
        );
      },
      planJson() {
        void deliverText(
          'Plan JSON',
          serializePlan(plan),
          `${slugify(plan.name)}-plan.json`,
          'application/json',
        );
      },
      workOrderJson() {
        if (!validation.manufacturable) {
          notify('Resolve the layout errors before issuing a work order.', 'error');
          return;
        }
        void deliverText(
          'Work order JSON',
          JSON.stringify(toWorkOrder(plan, bom, unit), null, 2),
          `${slugify(plan.name)}-work-order.json`,
          'application/json',
        );
      },
    }),
    [plan, bom, priceConfig, validation, unit, capturePlanImage, notify, deliverText],
  );

  return (
    // Full height on a desktop so the canvas fills the screen; on a narrow
    // screen the rails stack under the drawing and the page scrolls instead.
    <div className="flex h-full flex-col bg-slate-100 text-slate-900">
      <TopBar
        exports={exports}
        onOpenPlans={() => setDialog('plans')}
        onOpenPricing={() => setDialog('pricing')}
        onNewPlan={() => {
          useStore.getState().newPlan('Untitled plan');
          setDialog('plot');
        }}
      />

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {role !== 'client' && !compact && (
          <LeftRail
            onEditPlot={() => setDialog('plot')}
            onEditUnderlay={() => setDialog('underlay')}
          />
        )}
        <main className="relative order-first flex min-h-0 min-w-0 flex-1 flex-col lg:order-none">
          <div className="flex shrink-0 gap-1 border-b border-slate-200 bg-white px-2 py-1.5">
            {(['plan', '3d'] as const).map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => setView(id)}
                className={`rounded px-2.5 py-1 text-xs font-medium transition ${
                  view === id ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {id === 'plan' ? 'Plan' : '3D'}
              </button>
            ))}
          </div>

          {/* The plan canvas stays mounted: unmounting Konva would lose the
              viewport, and the PDF export captures its stage. */}
          <div className={`relative min-h-0 flex-1 ${view === 'plan' ? '' : 'hidden'}`}>
            <DesignCanvas validation={validation} areas={areas} stageRef={stageRef} />
            <CalibrationBanner />
          </div>

          {view === '3d' && (
            <div className="min-h-0 flex-1 overflow-hidden">
              <Suspense
                fallback={
                  <p className="flex h-full items-center justify-center text-sm text-slate-500">
                    Loading the 3D view&hellip;
                  </p>
                }
              >
                <ThreeView areas={areas} />
              </Suspense>
            </div>
          )}
          {compact && (
            <Sheet
              bom={bom}
              validation={validation}
              onEditPlot={() => setDialog('plot')}
              onEditUnderlay={() => setDialog('underlay')}
              onEditPricing={() => setDialog('pricing')}
              // A phone is for reading the answer; a tablet has room to draw.
              initialTab={phone ? 'materials' : 'tools'}
              initiallyOpen={!phone}
            />
          )}
        </main>
        {!compact && (
          <RightRail
            bom={bom}
            validation={validation}
            onEditPricing={() => setDialog('pricing')}
          />
        )}
      </div>

      {dialog === 'plot' && <PlotDialog onClose={() => setDialog(null)} />}
      {dialog === 'pricing' && <PricingDialog onClose={() => setDialog(null)} />}
      {dialog === 'plans' && <PlansDialog onClose={() => setDialog(null)} />}
      {dialog === 'underlay' && <UnderlayDialog onClose={() => setDialog(null)} />}

      {message && (
        <div
          role="status"
          className={`fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-lg px-4 py-2.5 text-sm font-medium shadow-lg ${
            message.tone === 'error' ? 'bg-red-600 text-white' : 'bg-slate-900 text-white'
          }`}
        >
          {message.text}
        </div>
      )}
    </div>
  );
}
