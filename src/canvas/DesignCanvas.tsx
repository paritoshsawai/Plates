import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Layer, Rect, Stage } from 'react-konva';
import type Konva from 'konva';
import { GridLayer } from './GridLayer';
import { PlotShape } from './PlotShape';
import { PanelShape } from './PanelShape';
import {
  BrushPreview,
  IssueMarkers,
  JunctionMarkers,
  RunDimensions,
  WallPreview,
} from './Annotations';
import { COLORS, fitToBox, nearestEdge, nearestNode, visibleUnits, zoomAt } from './view';
import type { Viewport } from './view';
import { plotBboxUnits } from '../core/plot';
import { isInsidePlot, wouldOverlap } from '../core/validation';
import { newPanelId } from '../core/panels';
import { detectJunctions } from '../core/junctions';
import { useStore } from '../state/store';
import type { GridEdge, GridPoint, Panel, ValidationResult } from '../core/types';

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
  const [spaceHeld, setSpaceHeld] = useState(false);

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

  const selectedIds = useMemo(() => new Set(selection), [selection]);
  const junctions = useMemo(() => detectJunctions(plan.panels), [plan.panels]);

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

  const panning = tool === 'select' || spaceHeld;

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
  };

  const handleMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const stage = e.target.getStage();
    if (!stage || e.target !== stage) return;
    const point = readPointer(stage);
    if (!point) return;

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

    clearSelection();
  };

  const handleWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = e.target.getStage();
    const pointer = stage?.getPointerPosition();
    if (!pointer) return;
    setViewport((current) => zoomAt(current, pointer, e.evt.deltaY));
  };

  const cursor = panning ? 'grab' : tool === 'wall' ? 'crosshair' : 'copy';

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
        }}
        onMouseDown={handleMouseDown}
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
          <GridLayer
            bounds={visibleUnits(viewport, size.width, size.height)}
            scale={viewport.scale}
          />
          <PlotShape plot={plan.plot} scale={viewport.scale} />
        </Layer>

        {/* Panels only take pointer events in select mode. While drawing, a
            click on an existing panel must fall through to the stage - a wall
            almost always starts at the corner where the last one ended. */}
        <Layer listening={tool === 'select'}>
          {plan.panels.map((panel) => (
            <PanelShape
              key={panel.id}
              panel={panel}
              selected={selectedIds.has(panel.id)}
              flagged={validation.flaggedPanelIds.has(panel.id)}
              draggable={tool === 'select'}
              onSelect={(id, additive) => select([id], additive)}
              onMoved={movePanel}
            />
          ))}
        </Layer>

        <Layer listening={false}>
          <JunctionMarkers junctions={junctions} scale={viewport.scale} />
          <RunDimensions panels={plan.panels} scale={viewport.scale} />
          <IssueMarkers issues={validation.errors} scale={viewport.scale} />
          {tool === 'wall' && (
            <WallPreview
              anchor={wallAnchor}
              cursor={hoverNode}
              category={activeCategory}
              scale={viewport.scale}
            />
          )}
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
          Scroll to zoom &middot; hold Space to pan
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
