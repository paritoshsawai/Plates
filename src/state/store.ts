import { create } from 'zustand';
import { createPlan, deserializePlan } from '../core/plan';
import { flipOrientation, getPanelSpec, newPanelId } from '../core/panels';
import { normalizePlot } from '../core/plot';
import { tileRun } from '../core/tiling';
import type { Orientation, Panel, PanelTypeId, Plan, Plot, PriceConfig } from '../core/types';
import { loadPriceConfig, localPlanRepository, savePriceConfig } from './storage';
import type { PlanSummary } from './storage';

export type Tool = 'select' | 'wall' | 'panel';

/**
 * Who is using the tool. This is a UI affordance, not access control - it
 * decides which panes render, nothing more. Real enforcement belongs on the
 * server alongside authentication, and must not be inferred from this value.
 */
export type Role = 'architect' | 'admin' | 'client';

/** The undoable document. Selection and tool state deliberately sit outside it. */
interface Doc {
  plot: Plot;
  panels: Panel[];
}

const HISTORY_LIMIT = 100;

export interface AppState {
  plan: Plan;
  priceConfig: PriceConfig;
  savedPlans: PlanSummary[];
  role: Role;

  tool: Tool;
  /** Which panel the 'panel' tool places. */
  brush: PanelTypeId;
  brushOrientation: Orientation;
  selection: string[];
  /** First node clicked with the wall tool, if a run is in progress. */
  wallAnchor: { x: number; y: number } | null;
  /** Transient user-facing message, e.g. why a placement was refused. */
  message: { text: string; tone: 'info' | 'error' } | null;
  dirty: boolean;

  past: Doc[];
  future: Doc[];

  setRole(role: Role): void;
  setTool(tool: Tool): void;
  setBrush(type: PanelTypeId): void;
  rotateBrush(): void;
  setWallAnchor(node: { x: number; y: number } | null): void;
  notify(text: string, tone?: 'info' | 'error'): void;
  clearMessage(): void;

  select(ids: string[], additive?: boolean): void;
  clearSelection(): void;
  selectAll(): void;

  addPanels(panels: Panel[]): void;
  placeBrush(x: number, y: number, orientation: Orientation): void;
  autoFillRun(from: { x: number; y: number }, to: { x: number; y: number }): void;
  movePanel(id: string, x: number, y: number): void;
  rotateSelection(): void;
  duplicateSelection(): void;
  deleteSelection(): void;

  setPlot(plot: Plot): void;
  setPlanName(name: string): void;
  setNotes(notes: string): void;

  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;

  newPlan(name: string, plot?: Plot): void;
  openPlan(id: string): void;
  saveVersion(): void;
  deleteSavedPlan(id: string): void;
  importPlan(json: string): void;
  refreshSavedPlans(): void;

  updatePriceConfig(patch: Partial<PriceConfig>): void;
}

function docOf(plan: Plan): Doc {
  return { plot: plan.plot, panels: plan.panels };
}

export const useStore = create<AppState>()((set, get) => {
  /**
   * Apply an edit to the document and record it for undo. Every mutation goes
   * through here, so history can never drift out of step with the plan.
   */
  const commit = (mutate: (doc: Doc) => Doc | null) => {
    const state = get();
    const current = docOf(state.plan);
    const next = mutate(current);
    if (!next) return;
    const past = [...state.past, current].slice(-HISTORY_LIMIT);
    set({
      plan: { ...state.plan, plot: next.plot, panels: next.panels, updatedAt: new Date().toISOString() },
      past,
      future: [],
      dirty: true,
    });
  };

  return {
    plan: createPlan('Untitled plan'),
    priceConfig: loadPriceConfig(),
    savedPlans: [],
    role: 'architect',

    tool: 'wall',
    brush: '4x10',
    brushOrientation: 'h',
    selection: [],
    wallAnchor: null,
    message: null,
    dirty: false,

    past: [],
    future: [],

    setRole: (role) =>
      // A client may look but not edit, so drop them onto the read-only tool.
      set({ role, tool: role === 'client' ? 'select' : get().tool, selection: [], wallAnchor: null }),

    setTool: (tool) => set({ tool, wallAnchor: null, selection: tool === 'select' ? get().selection : [] }),
    setBrush: (brush) => set({ brush }),
    rotateBrush: () => set({ brushOrientation: flipOrientation(get().brushOrientation) }),
    setWallAnchor: (wallAnchor) => set({ wallAnchor }),
    notify: (text, tone = 'info') => set({ message: { text, tone } }),
    clearMessage: () => set({ message: null }),

    select: (ids, additive = false) =>
      set((state) => {
        if (!additive) return { selection: ids };
        const next = new Set(state.selection);
        for (const id of ids) {
          if (next.has(id)) next.delete(id);
          else next.add(id);
        }
        return { selection: [...next] };
      }),
    clearSelection: () => set({ selection: [] }),
    selectAll: () => set((state) => ({ selection: state.plan.panels.map((p) => p.id), tool: 'select' })),

    addPanels: (panels) => {
      if (panels.length === 0) return;
      commit((doc) => ({ ...doc, panels: [...doc.panels, ...panels] }));
    },

    placeBrush: (x, y, orientation) => {
      const { brush } = get();
      const panel: Panel = { id: newPanelId(), type: brush, x, y, orientation };
      commit((doc) => ({ ...doc, panels: [...doc.panels, panel] }));
    },

    autoFillRun: (from, to) => {
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      if (dx !== 0 && dy !== 0) {
        get().notify('Walls run straight. Pick a second point on the same grid line.', 'error');
        return;
      }
      const lengthUnits = Math.abs(dx) + Math.abs(dy);
      if (lengthUnits === 0) return;

      const orientation: Orientation = dx !== 0 ? 'h' : 'v';
      const start = { x: Math.min(from.x, to.x), y: Math.min(from.y, to.y) };
      const panels = tileRun(start.x, start.y, lengthUnits, orientation);
      if (!panels) {
        get().notify('That run cannot be built from 4 ft and 2 ft panels.', 'error');
        return;
      }
      commit((doc) => ({ ...doc, panels: [...doc.panels, ...panels] }));
      set({ wallAnchor: null });
    },

    movePanel: (id, x, y) =>
      commit((doc) => {
        const index = doc.panels.findIndex((p) => p.id === id);
        if (index < 0) return null;
        const existing = doc.panels[index];
        if (existing.x === x && existing.y === y) return null;
        const panels = [...doc.panels];
        panels[index] = { ...existing, x, y };
        return { ...doc, panels };
      }),

    rotateSelection: () => {
      const selected = new Set(get().selection);
      if (selected.size === 0) return;
      commit((doc) => ({
        ...doc,
        panels: doc.panels.map((p) =>
          selected.has(p.id) ? { ...p, orientation: flipOrientation(p.orientation) } : p,
        ),
      }));
    },

    duplicateSelection: () => {
      const selected = new Set(get().selection);
      if (selected.size === 0) return;
      const copies: Panel[] = [];
      for (const panel of get().plan.panels) {
        if (!selected.has(panel.id)) continue;
        // Offset by the panel's own run so the copy lands beside the original
        // rather than on top of it, which would read as an overlap error.
        const len = getPanelSpec(panel.type).widthUnits;
        copies.push({
          ...panel,
          id: newPanelId(),
          x: panel.orientation === 'h' ? panel.x + len : panel.x + 1,
          y: panel.orientation === 'h' ? panel.y + 1 : panel.y + len,
        });
      }
      commit((doc) => ({ ...doc, panels: [...doc.panels, ...copies] }));
      set({ selection: copies.map((p) => p.id) });
    },

    deleteSelection: () => {
      const selected = new Set(get().selection);
      if (selected.size === 0) return;
      commit((doc) => ({ ...doc, panels: doc.panels.filter((p) => !selected.has(p.id)) }));
      set({ selection: [] });
    },

    setPlot: (plot) => commit((doc) => ({ ...doc, plot: normalizePlot(plot) })),

    setPlanName: (name) =>
      set((state) => ({ plan: { ...state.plan, name }, dirty: true })),

    setNotes: (notes) => set((state) => ({ plan: { ...state.plan, notes }, dirty: true })),

    undo: () => {
      const state = get();
      const previous = state.past[state.past.length - 1];
      if (!previous) return;
      set({
        plan: { ...state.plan, plot: previous.plot, panels: previous.panels },
        past: state.past.slice(0, -1),
        future: [docOf(state.plan), ...state.future].slice(0, HISTORY_LIMIT),
        selection: [],
        dirty: true,
      });
    },

    redo: () => {
      const state = get();
      const next = state.future[0];
      if (!next) return;
      set({
        plan: { ...state.plan, plot: next.plot, panels: next.panels },
        past: [...state.past, docOf(state.plan)].slice(-HISTORY_LIMIT),
        future: state.future.slice(1),
        selection: [],
        dirty: true,
      });
    },

    canUndo: () => get().past.length > 0,
    canRedo: () => get().future.length > 0,

    newPlan: (name, plot) =>
      set({
        plan: createPlan(name, plot),
        past: [],
        future: [],
        selection: [],
        wallAnchor: null,
        dirty: false,
        message: null,
      }),

    openPlan: (id) => {
      const plan = localPlanRepository.get(id);
      if (!plan) {
        get().notify('That plan could not be read from local storage.', 'error');
        return;
      }
      set({ plan, past: [], future: [], selection: [], wallAnchor: null, dirty: false });
    },

    saveVersion: () => {
      const state = get();
      const plan: Plan = {
        ...state.plan,
        version: state.plan.version + 1,
        updatedAt: new Date().toISOString(),
      };
      localPlanRepository.save(plan);
      set({ plan, dirty: false, savedPlans: localPlanRepository.list() });
      get().notify(`Saved "${plan.name}" as version ${plan.version}.`);
    },

    deleteSavedPlan: (id) => {
      localPlanRepository.remove(id);
      set({ savedPlans: localPlanRepository.list() });
    },

    importPlan: (json) => {
      try {
        const plan = deserializePlan(json);
        set({ plan, past: [], future: [], selection: [], wallAnchor: null, dirty: true });
        get().notify(`Imported "${plan.name}".`);
      } catch (error) {
        get().notify(error instanceof Error ? error.message : 'Import failed.', 'error');
      }
    },

    refreshSavedPlans: () => set({ savedPlans: localPlanRepository.list() }),

    updatePriceConfig: (patch) => {
      const next: PriceConfig = {
        ...get().priceConfig,
        ...patch,
        panelUnitPrice: { ...get().priceConfig.panelUnitPrice, ...(patch.panelUnitPrice ?? {}) },
      };
      savePriceConfig(next);
      set({ priceConfig: next });
    },
  };
});
