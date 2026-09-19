import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type Konva from 'konva';
import { DesignCanvas } from './canvas/DesignCanvas';
import { LeftRail } from './components/LeftRail';
import { RightRail } from './components/RightRail';
import { TopBar } from './components/TopBar';
import type { ExportActions } from './components/TopBar';
import { PlansDialog } from './components/PlansDialog';
import { PlotDialog } from './components/PlotDialog';
import { PricingDialog } from './components/PricingDialog';
import { buildBom } from './core/bom';
import { serializePlan } from './core/plan';
import { validatePlan } from './core/validation';
import { toWorkOrder } from './core/workorder';
import { bomToCsv } from './export/csv';
import { downloadBlob, downloadDataUrl, slugify } from './export/download';
import { useStore } from './state/store';

type Dialog = 'plot' | 'pricing' | 'plans' | null;

export default function App() {
  const stageRef = useRef<Konva.Stage | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);

  const plan = useStore((s) => s.plan);
  const priceConfig = useStore((s) => s.priceConfig);
  const role = useStore((s) => s.role);
  const message = useStore((s) => s.message);
  const clearMessage = useStore((s) => s.clearMessage);
  const notify = useStore((s) => s.notify);
  const refreshSavedPlans = useStore((s) => s.refreshSavedPlans);

  const validation = useMemo(() => validatePlan(plan.panels, plan.plot), [plan.panels, plan.plot]);
  const bom = useMemo(() => buildBom(plan.panels, priceConfig), [plan.panels, priceConfig]);

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
      if (e.key === '1') state.setTool('wall');
      if (e.key === '2') state.setTool('panel');
      if (e.key === '3') state.setTool('select');
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
    try {
      const content = stage.getClientRect({ skipTransform: false });
      const padding = 24;
      const crop =
        Number.isFinite(content.width) && content.width > 1 && content.height > 1
          ? {
              x: Math.max(0, content.x - padding),
              y: Math.max(0, content.y - padding),
              width: Math.min(stage.width(), content.width + padding * 2),
              height: Math.min(stage.height(), content.height + padding * 2),
            }
          : {};
      return stage.toDataURL({ pixelRatio: 2, ...crop });
    } catch (error) {
      console.warn('Could not capture the plan drawing.', error);
      return null;
    }
  }, []);

  const exports: ExportActions = useMemo(
    () => ({
      png() {
        const image = capturePlanImage();
        if (!image) {
          notify('The drawing could not be captured.', 'error');
          return;
        }
        downloadDataUrl(image, `${slugify(plan.name)}-plan.png`);
      },
      async pdf() {
        // jsPDF is a third of the bundle and only the quote needs it, so it
        // loads on demand rather than on first paint.
        const planImage = capturePlanImage();
        try {
          const { buildQuotePdf } = await import('./export/pdf');
          buildQuotePdf({ plan, bom, priceConfig, validation, planImage }).save(
            `${slugify(plan.name)}-quote.pdf`,
          );
        } catch (error) {
          console.error(error);
          notify('The quote PDF could not be generated.', 'error');
        }
      },
      csv() {
        downloadBlob(
          new Blob([bomToCsv(plan, bom)], { type: 'text/csv;charset=utf-8' }),
          `${slugify(plan.name)}-bom.csv`,
        );
      },
      planJson() {
        downloadBlob(
          new Blob([serializePlan(plan)], { type: 'application/json' }),
          `${slugify(plan.name)}-plan.json`,
        );
      },
      workOrderJson() {
        if (!validation.manufacturable) {
          notify('Resolve the layout errors before issuing a work order.', 'error');
          return;
        }
        downloadBlob(
          new Blob([JSON.stringify(toWorkOrder(plan, bom), null, 2)], {
            type: 'application/json',
          }),
          `${slugify(plan.name)}-work-order.json`,
        );
      },
    }),
    [plan, bom, priceConfig, validation, capturePlanImage, notify],
  );

  return (
    <div className="flex h-screen flex-col bg-slate-100 text-slate-900">
      <TopBar
        exports={exports}
        onOpenPlans={() => setDialog('plans')}
        onOpenPricing={() => setDialog('pricing')}
        onNewPlan={() => {
          useStore.getState().newPlan('Untitled plan');
          setDialog('plot');
        }}
      />

      <div className="flex min-h-0 flex-1">
        {role !== 'client' && <LeftRail onEditPlot={() => setDialog('plot')} />}
        <main className="min-w-0 flex-1">
          <DesignCanvas validation={validation} stageRef={stageRef} />
        </main>
        <RightRail
          bom={bom}
          validation={validation}
          onEditPricing={() => setDialog('pricing')}
        />
      </div>

      {dialog === 'plot' && <PlotDialog onClose={() => setDialog(null)} />}
      {dialog === 'pricing' && <PricingDialog onClose={() => setDialog(null)} />}
      {dialog === 'plans' && <PlansDialog onClose={() => setDialog(null)} />}

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
