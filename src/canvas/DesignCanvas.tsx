import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Layer, Rect, Stage } from 'react-konva';
import type Konva from 'konva';
import { GridLayer } from './GridLayer';
import { PlotShape } from './PlotShape';
import { PanelShape } from './PanelShape';
import { AreaShape } from './AreaShape';
import { CalibrationOverlay, UnderlayLayer } from './UnderlayLayer';
import {
  BrushPreview,
  IssueMarkers,
  JunctionMarkers,
  MarqueeBox,
  RunDimensions,
  UncoveredArea,
  WallPreview,
} from './Annotations';
import { COLORS, PX_PER_UNIT, fitToBox, nearestEdge, nearestNode, visibleUnits, zoomAt } from './view';
import type { Viewport } from './view';
import { plotBboxUnits } from '../core/plot';
import { isInsidePlot, wouldOverlap } from '../core/validation';
import { newPanelId, panelBoundsUnits, rectsIntersect, resolveOpeningClick } from '../core/panels';
import { detectJunctions } from '../core/junctions';
import { useStore } from '../state/store';
import { isLinearCategory } from '../core/types';
import type { GridEdge, GridPoint, Panel, ValidationResult } from '../core/types';
import type { UnitRect } from '../core/panels';

interface Props {
  validation: ValidationResult;
  stageRef: React.RefObject<Konva.Stage | null>;
}

export function DesignCanvas({ validation, stageRef }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [viewport, setViewport] = useState<Viewport>({ scale: 1, x: 80, y: 80 });
  const [hoverNode, setHoverNode] = useState<GridPoint | null>(null);
  const [hoverEdge, setHoverEdge] = useState<GridEdge | null>(null);
  const [hoverRaw, setHoverRaw] = useState<GridPoint | null>(null);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [marquee, setMarquee] = useState<UnitRect | null>(null);
  // The drag in progress, kept in a ref so a move handler never reads a stale
  // render's copy of it.
  const marqueeStart = useRef<{ x: number; y: number; additive: boolean } | null>(null);
  const marqueeRect = useRef<UnitRect | null>(null);
  const panStart = useRef<{ screenX: number; screenY: number; x: number; y: number } | null>(null);

  const plan = useStore((s) => s.plan);
  const tool = useStore((s) => s.tool);
  const brush = useStore((s) => s.brush);
  const activeCategory = useStore((s) => s.activeCategory);
  const selection = useStore((s) => s.selection);
  const wallAnchor = useStore((s) => s.wallAnchor);
  const setWallAnchor = useStore((s) => s.setWallAnchor);
  const autoFillRun = useStore((s) => s.autoFillRun);
  const addPanels = useStore((s) => s.addPanels);
  const movePanel = useStore((s) => s.movePanel);
  const select = useStore((s) => s.select);
  const clearSelection = useStore((s) => s.clearSelection);
  const notify = useStore((s) => s.notify);
  const openingBrush = useStore((s) => s.openingBrush);
  const setPanelCategory = useStore((s) => s.setPanelCategory);
  const hiddenLayers = useStore((s) => s.hiddenLayers);
  const calibration = useStore((s) => s.calibration);
  const setCalibrationPoint = useStore((s) => s.setCalibrationPoint);

  const selectedIds = useMemo(() => new Set(selection), [selection]);
  const junctions = useMemo(() => detectJunctions(plan.panels), [plan.panels]);

  // Hiding a layer only stops it drawing; the panels stay in the plan and in
  // the BOM, because hiding is a view control, not an edit.
  const visible = useMemo(
    () => plan.panels.filter((panel) => !hiddenLayers.includes(panel.category)),
    [plan.panels, hiddenLayers],
  );
  const areaPanels = useMemo(
    () => visible.filter((panel) => !isLinearCategory(panel.category)),
    [visible],
  );
  const linearPanels = useMemo(
    () => visible.filter((panel) => isLinearCategory(panel.category)),
    [visible],
  );

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ width: Math.max(320, width), height: Math.max(240, height) });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const fitToPlot = useCallback(() => {
    setViewport(fitToBox(plotBboxUnits(plan.plot), size.width, size.height));
  }, [plan.plot, size.width, size.height]);

  // Frame the parcel once the canvas has a real size, and again whenever the
  // user opens a different plan.
  const fittedFor = useRef<string>('');
  useEffect(() => {
    if (size.width <= 320 || fittedFor.current === plan.id) return;
    fittedFor.current = plan.id;
    fitToPlot();
  }, [plan.id, size.width, fitToPlot]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTypingTarget(e.target)) {
        e.preventDefault();
        setSpaceHeld(true);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceHeld(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  /**
   * Panning is hold-Space or middle-drag only.
   *
   * A plain drag in select mode now draws a selection box, which is what a
   * drag on empty canvas means in every drawing tool. Space was already the
   * documented pan modifier and is already hinted on screen, so nothing is
   * lost by making it the way to pan.
   */
  const panning = spaceHeld;

  // Middle-drag pans from anywhere, including over a panel, so it works even
  // when the canvas is full. Konva's own stage drag cannot be limited to one
  // button, hence moving the viewport by hand here.
  useEffect(() => {
    const move = (e: MouseEvent) => {
      const start = panStart.current;
      if (!start) return;
      setViewport((current) => ({
        ...current,
        x: start.x + (e.clientX - start.screenX),
        y: start.y + (e.clientY - start.screenY),
      }));
    };
    const up = () => {
      panStart.current = null;
      // The stage only sees a release over itself; this catches the rest.
      finishMarquee.current();
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, []);

  /** Marquee is for plain select mode: anywhere else a click already means something. */
  const marqueeArmed = tool === 'select' && !calibration.active && !openingBrush && !spaceHeld;

  const rectBetween = (a: { x: number; y: number }, b: { x: number; y: number }): UnitRect => ({
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  });

  const readPointer = (stage: Konva.Stage) => {
    const point = stage.getRelativePointerPosition();
    if (!point) return null;
    return point;
  };

  const handleMouseMove = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const stage = e.target.getStage();
    if (!stage) return;
    const point = readPointer(stage);
    if (!point) return;
    setHoverNode(nearestNode(point.x, point.y));
    setHoverEdge(nearestEdge(point.x, point.y));
    const units = { x: point.x / PX_PER_UNIT, y: point.y / PX_PER_UNIT };
    setHoverRaw(units);
    if (marqueeStart.current) {
      const rect = rectBetween(marqueeStart.current, units);
      marqueeRect.current = rect;
      setMarquee(rect);
    }
  };

  const handleMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const stage = e.target.getStage();
    if (!stage) return;

    if (e.evt.button === 1) {
      e.evt.preventDefault();
      panStart.current = {
        screenX: e.evt.clientX,
        screenY: e.evt.clientY,
        x: stage.x(),
        y: stage.y(),
      };
      return;
    }

    if (e.target !== stage || e.evt.button !== 0) return;
    const point = readPointer(stage);
    if (!point) return;

    if (calibration.active) {
      // Unsnapped: a scan does not line up with the grid, which is exactly why
      // it needs calibrating in the first place.
      setCalibrationPoint({ x: point.x / PX_PER_UNIT, y: point.y / PX_PER_UNIT });
      return;
    }

    if (tool === 'wall') {
      const node = nearestNode(point.x, point.y);
      if (!wallAnchor) {
        setWallAnchor(node);
        return;
      }
      // Walls run straight: commit along whichever axis the user moved further.
      const dx = node.x - wallAnchor.x;
      const dy = node.y - wallAnchor.y;
      const end =
        Math.abs(dx) >= Math.abs(dy)
          ? { x: node.x, y: wallAnchor.y }
          : { x: wallAnchor.x, y: node.y };
      if (end.x === wallAnchor.x && end.y === wallAnchor.y) {
        setWallAnchor(null);
        return;
      }
      autoFillRun(wallAnchor, end);
      return;
    }

    if (tool === 'panel') {
      const edge = nearestEdge(point.x, point.y);
      const candidate: Panel = {
        id: newPanelId(),
        category: activeCategory,
        size: brush,
        x: edge.x,
        y: edge.y,
        orientation: edge.axis,
      };
      if (wouldOverlap(plan.panels, candidate)) {
        notify('That 2 ft of wall is already covered by another panel.', 'error');
        return;
      }
      if (!isInsidePlot(plan.plot, candidate)) {
        notify('Panels must stay inside the plot boundary.', 'error');
        return;
      }
      addPanels([candidate]);
      return;
    }

    if (marqueeArmed) {
      const units = { x: point.x / PX_PER_UNIT, y: point.y / PX_PER_UNIT };
      marqueeStart.current = { ...units, additive: e.evt.shiftKey };
      setMarquee({ ...units, width: 0, height: 0 });
      return;
    }

    // Panning is a view change, not an edit: it must not drop the selection
    // the user is part-way through building.
    if (panning) return;

    clearSelection();
  };

  /**
   * Close the marquee.
   *
   * It finishes from the last rectangle drawn rather than from the pointer at
   * release, so letting go outside the canvas - which is exactly how you box
   * everything along one edge - still selects what the box visibly covered.
   * A box smaller than half a grid unit was a click, not a drag, so it keeps
   * the old meaning of clearing the selection.
   */
  const finishMarquee = useRef<() => void>(() => {});
  finishMarquee.current = () => {
    const start = marqueeStart.current;
    const rect = marqueeRect.current;
    marqueeStart.current = null;
    marqueeRect.current = null;
    setMarquee(null);
    if (!start) return;

    const clearUnlessAdding = () => {
      if (!start.additive) clearSelection();
    };
    if (!rect || (rect.width < 0.5 && rect.height < 0.5)) return clearUnlessAdding();

    // Hidden layers are not selectable: the architect cannot see what they
    // would be grabbing.
    const hits = visible
      .filter((panel) => rectsIntersect(panelBoundsUnits(panel), rect))
      .map((panel) => panel.id);
    if (hits.length === 0) return clearUnlessAdding();

    // Shift *adds* here rather than toggling the way shift-click does: a box
    // dragged over panels means "these too", never "un-pick these".
    select(start.additive ? [...new Set([...selection, ...hits])] : hits);
  };

  const handleWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = e.target.getStage();
    const pointer = stage?.getPointerPosition();
    if (!pointer) return;
    setViewport((current) => zoomAt(current, pointer, e.evt.deltaY));
  };

  const cursor = calibration.active
    ? 'crosshair'
    : openingBrush
      ? 'cell'
      : panning
        ? 'grab'
        : tool === 'wall'
          ? 'crosshair'
          : tool === 'select'
            ? 'default'
            : 'copy';

  return (
    <div ref={containerRef} className="relative h-full w-full bg-white" style={{ cursor }}>
      <Stage
        ref={stageRef}
        width={size.width}
        height={size.height}
        scaleX={viewport.scale}
        scaleY={viewport.scale}
        x={viewport.x}
        y={viewport.y}
        draggable={panning}
        onDragEnd={(e) => {
          if (e.target !== e.target.getStage()) return;
          setViewport((current) => ({ ...current, x: e.target.x(), y: e.target.y() }));
        }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => {
          setHoverNode(null);
          setHoverEdge(null);
          setHoverRaw(null);
        }}
        onMouseDown={handleMouseDown}
        onMouseUp={() => finishMarquee.current()}
        onContextMenu={(e) => e.evt.preventDefault()}
        onWheel={handleWheel}
      >
        <Layer listening={false}>
          {/* Opaque backdrop so PNG and PDF exports are not transparent. */}
          <Rect
            x={-100000}
            y={-100000}
            width={200000}
            height={200000}
            fill="#ffffff"
            listening={false}
          />
          {/* The scan goes under the grid: it is something to trace, not part
              of the drawing. */}
          <UnderlayLayer underlay={plan.underlay} />
          <GridLayer
            bounds={visibleUnits(viewport, size.width, size.height)}
            scale={viewport.scale}
          />
          <PlotShape plot={plan.plot} scale={viewport.scale} />
        </Layer>

        {/* Floor and roof sit beneath the walls on their own plane. */}
        <Layer listening={tool === 'select' && !openingBrush}>
          {areaPanels.map((panel) => (
            <AreaShape
              key={panel.id}
              panel={panel}
              selected={selectedIds.has(panel.id)}
              flagged={validation.flaggedPanelIds.has(panel.id)}
              draggable={tool === 'select' && !openingBrush}
              onSelect={(id, additive) => select([id], additive)}
              onMoved={movePanel}
            />
          ))}
        </Layer>

        {/* Panels only take pointer events in select mode. While drawing, a
            click on an existing panel must fall through to the stage - a wall
            almost always starts at the corner where the last one ended. */}
        <Layer listening={tool === 'select'}>
          {linearPanels.map((panel) => (
            <PanelShape
              key={panel.id}
              panel={panel}
              selected={selectedIds.has(panel.id)}
              flagged={validation.flaggedPanelIds.has(panel.id)}
              draggable={tool === 'select' && !openingBrush}
              onSelect={(id, additive) => {
                // With an opening brush armed, clicking converts rather than
                // selects. The rule lives in resolveOpeningClick so the 3D view
                // applies exactly the same one.
                const current = plan.panels.find((p) => p.id === id);
                const converted = resolveOpeningClick(current, openingBrush);
                if (converted) setPanelCategory(id, converted);
                else select([id], additive);
              }}
              onMoved={movePanel}
            />
          ))}
        </Layer>

        <Layer listening={false}>
          <JunctionMarkers junctions={junctions} scale={viewport.scale} />
          <RunDimensions panels={linearPanels} scale={viewport.scale} />
          <UncoveredArea issues={validation.errors} scale={viewport.scale} />
          <MarqueeBox rect={marquee} scale={viewport.scale} />
          <IssueMarkers issues={validation.errors} scale={viewport.scale} />
          {tool === 'wall' && (
            <WallPreview
              anchor={wallAnchor}
              cursor={hoverNode}
              category={activeCategory}
              scale={viewport.scale}
            />
          )}
          <CalibrationOverlay
            from={calibration.active ? calibration.from : null}
            cursor={calibration.active ? hoverRaw : null}
            scale={viewport.scale}
          />
          {tool === 'panel' && (
            <BrushPreview
              edge={hoverEdge}
              size={brush}
              category={activeCategory}
              scale={viewport.scale}
            />
          )}
        </Layer>
      </Stage>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between p-3 text-xs">
        <span className="pointer-events-auto rounded bg-slate-900/80 px-2 py-1 font-mono text-white">
          {hoverNode ? `${hoverNode.x * 2} ft, ${hoverNode.y * 2} ft` : '—'}
        </span>
        <span className="pointer-events-auto rounded bg-white/90 px-2 py-1 text-slate-600 ring-1 ring-slate-200">
          Scroll to zoom &middot; drag to select &middot; Space or middle-drag to pan
        </span>
      </div>

      <button
        type="button"
        onClick={fitToPlot}
        className="absolute right-3 top-3 rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50"
        style={{ color: COLORS.label }}
      >
        Fit to plot
      </button>
    </div>
  );
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable;
}
