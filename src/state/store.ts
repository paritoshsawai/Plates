import { create } from 'zustand';
import { createPlan, deserializePlan } from '../core/plan';
import { flipOrientation, getPanelSpec, newPanelId, visiblePanels } from '../core/panels';
import { isLinearCategory, isOpeningCategory } from '../core/types';
import { normalizePlot } from '../core/plot';
import { canPlace } from '../core/validation';
import { tileRun } from '../core/tiling';
import { bestTileFootprint, tileFootprint } from '../core/areaTiling';
import { interiorCells } from '../core/footprint';
import { GRID_FT } from '../core/units';
import type {
  GridPoint,
  Orientation,
  Panel,
  PanelCategory,
  PanelSizeId,
  Plan,
  Plot,
  PriceConfig,
  Underlay,
} from '../core/types';
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
  brush: PanelSizeId;
  brushOrientation: Orientation;
  /** The category new panels are created in, and the layer editing targets. */
  activeCategory: PanelCategory;
  /**
   * When set, clicking a panel converts it to this category instead of
   * selecting it. Null means the normal select behaviour.
   */
  openingBrush: PanelCategory | null;
  /** Categories currently drawn. Hiding one never deletes its panels. */
  hiddenLayers: PanelCategory[];
  /**
   * Which way each area category's 10 ft strips run. Absent means the next fill
   * chooses for itself; a fill always writes back what it actually used.
   */
  areaAxis: Partial<Record<PanelCategory, Orientation>>;
  /**
   * Two-point scale calibration for the underlay. `from` is set by the first
   * click; once `to` lands the dialog asks what that distance really is.
   * Points are unsnapped world units - a scan does not line up with the grid,
   * which is the whole reason it needs calibrating.
   */
  calibration: { active: boolean; from: GridPoint | null; to: GridPoint | null };
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
  setBrush(size: PanelSizeId): void;
  setActiveCategory(category: PanelCategory): void;
  setOpeningBrush(category: PanelCategory | null): void;
  rotateBrush(): void;
  setWallAnchor(node: { x: number; y: number } | null): void;
  notify(text: string, tone?: 'info' | 'error'): void;
  clearMessage(): void;

  select(ids: string[], additive?: boolean): void;
  clearSelection(): void;
  selectAll(): void;

  addPanels(panels: Panel[]): void;
  placeBrush(x: number, y: number, orientation: Orientation): void;
  setPanelCategory(id: string, category: PanelCategory): void;
  splitPanel(id: string): void;
  fillArea(category: PanelCategory, orientation?: Orientation): void;
  setAreaAxis(category: PanelCategory, orientation: Orientation): void;
  clearArea(category: PanelCategory): void;
  toggleLayer(category: PanelCategory): void;
  showAllLayers(): void;
  autoFillRun(from: { x: number; y: number }, to: { x: number; y: number }): void;
  movePanel(id: string, x: number, y: number): void;
  rotateSelection(): void;
  nudgeSelection(dx: number, dy: number): void;
  duplicateSelection(): void;
  deleteSelection(): void;

  setPlot(plot: Plot): void;
  setPlanName(name: string): void;
  setNotes(notes: string): void;
  setUnderlay(underlay: Underlay | null): void;
  updateUnderlay(patch: Partial<Underlay>): void;
  startCalibration(): void;
  cancelCalibration(): void;
  setCalibrationPoint(point: GridPoint): void;
  applyCalibration(realFeet: number): void;

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
  const countByCategory = (panels: Panel[]): Map<PanelCategory, number> => {
    const counts = new Map<PanelCategory, number>();
    for (const panel of panels) counts.set(panel.category, (counts.get(panel.category) ?? 0) + 1);
    return counts;
  };

  const commit = (mutate: (doc: Doc) => Doc | null) => {
    const state = get();
    const current = docOf(state.plan);
    const next = mutate(current);
    if (!next) return;
    const past = [...state.past, current].slice(-HISTORY_LIMIT);

    // Never leave the user staring at a tool that looks dead. Anything that
    // *adds* panels to a hidden category reveals it - drawing a wall with walls
    // hidden, filling a cleared floor, converting a wall into a hidden door.
    // This lives here rather than at each of the seven creation sites because
    // every panel mutation already passes through commit, so the invariant
    // cannot be forgotten by a creation path written later. Actions that only
    // remove panels, like clearArea, never trip it.
    const before = countByCategory(current.panels);
    const after = countByCategory(next.panels);
    const hiddenLayers = state.hiddenLayers.filter(
      (category) => (after.get(category) ?? 0) <= (before.get(category) ?? 0),
    );

    set({
      plan: { ...state.plan, plot: next.plot, panels: next.panels, updatedAt: new Date().toISOString() },
      past,
      future: [],
      dirty: true,
      hiddenLayers,
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
    activeCategory: 'wall',
    openingBrush: null,
    hiddenLayers: [],
    areaAxis: {},
    calibration: { active: false, from: null, to: null },
    selection: [],
    wallAnchor: null,
    message: null,
    dirty: false,

    past: [],
    future: [],

    setRole: (role) =>
      // A client may look but not edit, so drop them onto the read-only tool.
      set({ role, tool: role === 'client' ? 'select' : get().tool, selection: [], wallAnchor: null }),

    setTool: (tool) =>
      set({
        tool,
        wallAnchor: null,
        openingBrush: tool === 'select' ? get().openingBrush : null,
        selection: tool === 'select' ? get().selection : [],
      }),
    setBrush: (brush) => set({ brush }),
    setActiveCategory: (activeCategory) =>
      set({ activeCategory, openingBrush: null, selection: [], wallAnchor: null }),

    // Converting needs the select tool's hit-testing, so switching on an
    // opening brush also switches to it.
    setOpeningBrush: (openingBrush) =>
      set({ openingBrush, tool: openingBrush ? 'select' : get().tool, selection: [] }),
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
    selectAll: () =>
      set((state) => ({
        selection: visiblePanels(state.plan.panels, state.hiddenLayers).map((p) => p.id),
        tool: 'select',
      })),

    addPanels: (panels) => {
      if (panels.length === 0) return;
      commit((doc) => ({ ...doc, panels: [...doc.panels, ...panels] }));
    },

    placeBrush: (x, y, orientation) => {
      const { brush, activeCategory } = get();
      const panel: Panel = {
        id: newPanelId(),
        category: activeCategory,
        size: brush,
        x,
        y,
        orientation,
      };
      commit((doc) => ({ ...doc, panels: [...doc.panels, panel] }));
    },

    /**
     * Turn an existing panel into another category in place, keeping its size,
     * position and orientation.
     *
     * Openings are conversions rather than insertions: Arplace pre-cuts them
     * into a panel at the factory, so a door *is* the panel in that slot. Doing
     * it in place also means the sizes always match by construction, so there
     * is no "2 ft door on a 4 ft panel" mismatch to refuse.
     */
    setPanelCategory: (id, category) =>
      commit((doc) => {
        const index = doc.panels.findIndex((p) => p.id === id);
        if (index < 0) return null;
        const existing = doc.panels[index];
        if (existing.category === category) return null;

        const panels = [...doc.panels];
        const next: Panel = { ...existing, category };
        // Swing and sill are meaningless on a wall, so drop them on the way out
        // rather than leaving stale detail on the panel.
        if (isOpeningCategory(category)) next.opening = existing.opening ?? {};
        else delete next.opening;
        panels[index] = next;
        return { ...doc, panels };
      }),

    /**
     * Replace one 4 ft panel with two 2 ft panels covering the same edges.
     *
     * Without this a 2 ft opening is often impossible to place: the run was
     * auto-tiled with 4 ft panels, and an opening can only take the size of the
     * panel it replaces.
     */
    splitPanel: (id) =>
      commit((doc) => {
        const index = doc.panels.findIndex((p) => p.id === id);
        if (index < 0) return null;
        const existing = doc.panels[index];
        const halfUnits = getPanelSpec('2x10').widthUnits;
        if (getPanelSpec(existing.size).widthUnits <= halfUnits) return null;

        const halves: Panel[] = [0, 1].map((n) => ({
          ...existing,
          id: newPanelId(),
          size: '2x10',
          x: existing.orientation === 'h' ? existing.x + n * halfUnits : existing.x,
          y: existing.orientation === 'h' ? existing.y : existing.y + n * halfUnits,
        }));

        const panels = [...doc.panels];
        panels.splice(index, 1, ...halves);
        return { ...doc, panels };
      }),

    /**
     * Lay a floor or roof over the building the walls enclose.
     *
     * Replaces that category wholesale rather than adding to it: filling twice
     * should give the same result as filling once, not two stacked floors.
     * Strips run whichever way covers more, since an architect should not have
     * to work out which axis divides by 10 ft.
     */
    fillArea: (category, orientation) => {
      const footprint = interiorCells(get().plan.panels);
      if (footprint.cells.length === 0) {
        get().notify('Close the walls into a room before filling a floor or roof.', 'error');
        return;
      }

      // With no direction asked for, pick whichever strip direction covers more
      // of the building; with one, lay it that way even if it covers less. The
      // architect may have a reason - a joist run, a slope - that the panel
      // count cannot see.
      const result = orientation
        ? { ...tileFootprint(footprint, category, orientation), orientation }
        : bestTileFootprint(footprint, category);
      if (result.panels.length === 0) {
        get().notify(
          `No part of this building is 10 ft deep, so no ${category} panel fits.`,
          'error',
        );
        return;
      }

      commit((doc) => ({
        ...doc,
        panels: [...doc.panels.filter((p) => p.category !== category), ...result.panels],
      }));
      // Record the direction actually used, including the one picked
      // automatically, so the control reflects the real layout rather than a
      // guess at it.
      set((state) => ({ areaAxis: { ...state.areaAxis, [category]: result.orientation } }));

      if (result.uncoveredSqFt > 0) {
        get().notify(
          `${result.uncoveredSqFt} sq ft has no ${category}: a 10 ft panel cannot reach a strip that shallow.`,
        );
      }
    },

    /**
     * Re-lay a floor or roof with its 10 ft strips running the other way.
     *
     * The toggle is the action, not a setting to apply later: choosing a
     * direction with panels already down re-fills immediately, and choosing one
     * with nothing down just remembers it for the next fill.
     */
    setAreaAxis: (category, orientation) => {
      if (get().areaAxis[category] === orientation) return;
      set((state) => ({ areaAxis: { ...state.areaAxis, [category]: orientation } }));
      if (get().plan.panels.some((p) => p.category === category)) {
        get().fillArea(category, orientation);
      }
    },

    clearArea: (category) =>
      commit((doc) => {
        const panels = doc.panels.filter((p) => p.category !== category);
        return panels.length === doc.panels.length ? null : { ...doc, panels };
      }),

    toggleLayer: (category) =>
      set((state) => {
        const hiding = !state.hiddenLayers.includes(category);
        if (!hiding) {
          return { hiddenLayers: state.hiddenLayers.filter((c) => c !== category) };
        }
        // Nothing off-screen stays selected: Rotate, Delete and the arrow keys
        // all act on the selection, and acting on what you cannot see is how a
        // layer control turns into lost work.
        const hiddenIds = new Set(
          state.plan.panels.filter((p) => p.category === category).map((p) => p.id),
        );
        return {
          hiddenLayers: [...state.hiddenLayers, category],
          selection: state.selection.filter((id) => !hiddenIds.has(id)),
        };
      }),

    showAllLayers: () => set({ hiddenLayers: [] }),

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
      const panels = tileRun(start.x, start.y, lengthUnits, orientation, get().activeCategory);
      if (!panels) {
        get().notify('That run cannot be built from 4 ft and 2 ft panels.', 'error');
        return;
      }
      commit((doc) => ({ ...doc, panels: [...doc.panels, ...panels] }));
      set({ wallAnchor: null });
    },

    /**
     * Drop a dragged panel at a grid position.
     *
     * An *area* panel's drop is checked: it claims a whole block of cells, so a
     * bad drop buries a neighbour under it and is hard to see and harder to
     * undo. A linear panel's drop is deliberately not checked - dragging a wall
     * into an overlap and then tidying it up is a normal way to work, and the
     * validator already says so on screen.
     */
    movePanel: (id, x, y) => {
      const { panels: current, plot } = get().plan;
      const moving = current.find((p) => p.id === id);
      if (!moving || (moving.x === x && moving.y === y)) return;

      if (!isLinearCategory(moving.category)) {
        const candidate = { ...moving, x, y };
        if (!canPlace(current, plot, candidate)) {
          get().notify(
            `That would put the ${moving.category} panel on top of another one, or outside the plot.`,
            'error',
          );
          return;
        }
      }

      commit((doc) => {
        const index = doc.panels.findIndex((p) => p.id === id);
        if (index < 0) return null;
        const panels = [...doc.panels];
        panels[index] = { ...panels[index], x, y };
        return { ...doc, panels };
      });
    },

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

    /**
     * Move the whole selection one 2 ft step.
     *
     * All or nothing: if any panel in the selection cannot legally land on the
     * step, the move is refused entirely. A partial nudge would silently break
     * the run the selection was drawn from, which is worse than not moving.
     * The selection is tested against the panels that are *not* moving, so a
     * run sliding along itself is not read as colliding with its own tail.
     */
    nudgeSelection: (dx, dy) => {
      const selected = new Set(get().selection);
      if (selected.size === 0 || (dx === 0 && dy === 0)) return;

      const { panels, plot } = get().plan;
      const stationary = panels.filter((p) => !selected.has(p.id));
      const moved = panels
        .filter((p) => selected.has(p.id))
        .map((p) => ({ ...p, x: p.x + dx, y: p.y + dy }));

      for (const panel of moved) {
        if (!canPlace([...stationary, ...moved], plot, panel)) {
          set({
            message: {
              text: 'That move would push a panel outside the plot or onto another one.',
              tone: 'error',
            },
          });
          return;
        }
      }

      const byId = new Map(moved.map((p) => [p.id, p]));
      commit((doc) => ({ ...doc, panels: doc.panels.map((p) => byId.get(p.id) ?? p) }));
    },

    duplicateSelection: () => {
      const selected = new Set(get().selection);
      if (selected.size === 0) return;
      const copies: Panel[] = [];
      for (const panel of get().plan.panels) {
        if (!selected.has(panel.id)) continue;
        // Offset by the panel's own run so the copy lands beside the original
        // rather than on top of it, which would read as an overlap error.
        const len = getPanelSpec(panel.size).widthUnits;
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

    setUnderlay: (underlay) =>
      set((state) => {
        const plan = { ...state.plan };
        if (underlay) plan.underlay = underlay;
        else delete plan.underlay;
        return { plan, dirty: true };
      }),

    startCalibration: () =>
      set({ calibration: { active: true, from: null, to: null }, tool: 'select', selection: [] }),

    cancelCalibration: () => set({ calibration: { active: false, from: null, to: null } }),

    setCalibrationPoint: (point) =>
      set((state) => {
        const { from } = state.calibration;
        return from
          ? { calibration: { ...state.calibration, to: point } }
          : { calibration: { ...state.calibration, from: point, to: null } };
      }),

    /**
     * Rescale the underlay so the calibrated span really is `realFeet` long.
     *
     * The first clicked point is held still, so the image grows or shrinks
     * around the feature the architect was pointing at rather than jumping
     * away from it.
     */
    applyCalibration: (realFeet) => {
      const state = get();
      const { from, to } = state.calibration;
      const underlay = state.plan.underlay;
      if (!from || !to || !underlay) return;

      const spanUnits = Math.hypot(to.x - from.x, to.y - from.y);
      if (!(spanUnits > 0) || !(realFeet > 0)) {
        state.notify('Pick two different points and a positive distance.', 'error');
        return;
      }

      const factor = realFeet / GRID_FT / spanUnits;
      set({
        plan: {
          ...state.plan,
          underlay: {
            ...underlay,
            scale: underlay.scale * factor,
            x: from.x + (underlay.x - from.x) * factor,
            y: from.y + (underlay.y - from.y) * factor,
          },
        },
        calibration: { active: false, from: null, to: null },
        dirty: true,
      });
      state.notify(`Underlay scaled so that span reads ${realFeet} ft.`);
    },

    updateUnderlay: (patch) =>
      set((state) => {
        if (!state.plan.underlay) return {};
        return {
          plan: { ...state.plan, underlay: { ...state.plan.underlay, ...patch } },
          dirty: true,
        };
      }),

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
      const current = get().priceConfig;
      const next: PriceConfig = {
        ...current,
        ...patch,
        // Rows replace wholesale when supplied; the dialog always hands over a
        // complete set, so merging row by row would only let a stale row linger.
        rows: patch.rows ?? current.rows,
      };
      savePriceConfig(next);
      set({ priceConfig: next });
    },
  };
});
