import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Group, Layer, Rect, Stage } from 'react-konva';
import type Konva from 'konva';
import { Konva as KonvaGlobal } from 'konva/lib/Global';
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
  RoomPreview,
  RunDimensions,
  SnapRing,
  UncoveredArea,
  WallPreview,
} from './Annotations';
import {
  COLORS,
  EXPORT_HIDDEN,
  PX_PER_UNIT,
  fitToBox,
  nearestEdge,
  nearestNode,
  visibleUnits,
  zoomAt,
  zoomBy,
} from './view';
import { midpoint, pinchFactor, pointerDistance } from '../core/gestures';
import type { Viewport } from './view';
import { plotBboxUnits } from '../core/plot';
import { isInsidePlot, wouldOverlap } from '../core/validation';
import {
  newPanelId,
  panelBoundsUnits,
  rectsIntersect,
  resolveOpeningClick,
  visiblePanels,
} from '../core/panels';
import { detectJunctions } from '../core/junctions';
import { straightEnd } from '../core/room';
import { formatLength, unitsToFt } from '../core/units';
import { useCoarsePointer } from '../components/useMediaQuery';

// Konva stops hit-testing and stops updating pointer positions while a node is
// being dragged. With the stage draggable - which is how a finger pans - that
// means a second finger is never registered, so a pinch arrives as a one-finger
// pan. This is the documented switch for multi-touch.
KonvaGlobal.hitOnDragEnabled = true;
import { AreaReadout } from '../components/AreaReadout';
import { SlideToDelete } from '../components/SlideToDelete';
import { CATEGORY_STYLE } from '../core/panels';
import type { PlanAreas } from '../components/AreaReadout';
import { useStore } from '../state/store';
import { isLinearCategory } from '../core/types';
import type { GridEdge, GridPoint, Panel, ValidationResult } from '../core/types';
import type { UnitRect } from '../core/panels';

interface Props {
  validation: ValidationResult;
  areas: PlanAreas;
  stageRef: React.RefObject<Konva.Stage | null>;
}

export function DesignCanvas({ validation, areas, stageRef }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [viewport, setViewport] = useState<Viewport>({ scale: 1, x: 80, y: 80 });
  const [hoverNode, setHoverNode] = useState<GridPoint | null>(null);
  const [hoverEdge, setHoverEdge] = useState<GridEdge | null>(null);
  const [hoverRaw, setHoverRaw] = useState<GridPoint | null>(null);
  const [spaceHeld, setSpaceHeld] = useState(false);
  /**
   * Whether `size` is a real measurement yet, rather than the placeholder.
   *
   * State and not a ref: a ref flips the instant the observer fires, which can
   * land before React has applied the `setSize` from the same callback. The
   * fit effect then ran against the stale placeholder size and marked itself
   * done, so the real measurement never got a fit. Batched state cannot
   * disagree with itself that way.
   */
  const [measured, setMeasured] = useState(false);
  /**
   * When a finger last touched the canvas.
   *
   * A touchscreen fires a compatibility `mousedown` a moment after every tap.
   * Left alone it re-enters placement at the same point, where the wall tool
   * reads an anchor and a cursor in the same place as a zero-length run and
   * clears the anchor again - so tapping twice built nothing at all. Mouse
   * events arriving in the shadow of a touch are that echo, and are ignored.
   */
  const lastTouchAt = useRef(0);

  /** Finger span and midpoint from the previous touchmove, while pinching. */
  const pinch = useRef<{ distance: number; mid: { x: number; y: number } } | null>(null);
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
  const unit = useStore((s) => s.unit);
  const coarsePointer = useCoarsePointer();
  const setCalibrationPoint = useStore((s) => s.setCalibrationPoint);
  const buildRoom = useStore((s) => s.buildRoom);
  const deleteSelection = useStore((s) => s.deleteSelection);

  /**
   * The panel a finger is resting on, if any.
   *
   * Deleting is a keystroke on a desktop and had no equivalent at all on a
   * touchscreen: there is no Delete key and no right-click. Holding a panel
   * opens the actions for it.
   */
  const [heldPanelId, setHeldPanelId] = useState<string | null>(null);
  const holdEnabled = coarsePointer && tool === 'select' && !openingBrush;
  const heldPanel = heldPanelId ? plan.panels.find((p) => p.id === heldPanelId) : undefined;

  const selectedIds = useMemo(() => new Set(selection), [selection]);
  const junctions = useMemo(() => detectJunctions(plan.panels), [plan.panels]);

  // Hiding a layer only stops it drawing; the panels stay in the plan and in
  // the BOM, because hiding is a view control, not an edit.
  const visible = useMemo(
    () => visiblePanels(plan.panels, hiddenLayers),
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
      setMeasured(true);
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
  //
  // It has to wait for the observer rather than trusting `size`, which starts
  // at a placeholder 800 x 600. Fitting to that guess framed the plot for a
  // container nobody had measured - barely noticeable on a laptop, where 800
  // is close to the truth, and badly wrong on a 390 px phone, which opened
  // showing a corner of the parcel with no way to tell why.
  const fittedFor = useRef<string>('');
  useEffect(() => {
    if (!measured || fittedFor.current === plan.id) return;
    fittedFor.current = plan.id;
    fitToPlot();
  }, [plan.id, measured, size.width, size.height, fitToPlot]);

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
   *
   * On a touchscreen that inverts: there is no space bar and no middle button,
   * so a drag has to pan or the drawing cannot be moved at all.
   *
   * Except in the drawing tools, where the finger is drawing. There two
   * fingers pan and zoom instead, which the pinch handler does on its own
   * without the stage being draggable at all.
   */
  const drawingTool = tool === 'wall' || tool === 'room';
  const panning = spaceHeld || (coarsePointer && !drawingTool);

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

  /**
   * A press-drag-release on the canvas while a drawing tool is active.
   *
   * Held in a ref because the commit reads it from an event handler, where a
   * state value would be a render behind. `preview` mirrors it for drawing.
   */
  const draw = useRef<{ start: GridPoint; end: GridPoint; moved: boolean } | null>(null);
  const [drawPreview, setDrawPreview] = useState<{ start: GridPoint; end: GridPoint } | null>(null);

  const beginDraw = (point: { x: number; y: number }) => {
    const node = nearestNode(point.x, point.y);
    draw.current = { start: node, end: node, moved: false };
    setDrawPreview({ start: node, end: node });
  };

  const updateDraw = (point: { x: number; y: number }) => {
    const gesture = draw.current;
    if (!gesture) return;
    const node = nearestNode(point.x, point.y);
    if (node.x !== gesture.start.x || node.y !== gesture.start.y) gesture.moved = true;
    gesture.end = node;
    setDrawPreview({ start: gesture.start, end: node });
  };

  /**
   * Release. A drag commits what the preview showed; a press that never moved
   * falls back to the two-point flow, so tapping twice still works and the
   * desktop's click-click is unchanged.
   */
  const finishDraw = () => {
    const gesture = draw.current;
    draw.current = null;
    setDrawPreview(null);
    if (!gesture) return;

    if (!gesture.moved) {
      placeAtNode(gesture.start);
      return;
    }
    if (tool === 'room') {
      buildRoom(gesture.start, gesture.end);
      return;
    }
    autoFillRun(gesture.start, straightEnd(gesture.start, gesture.end));
  };

  /** Marquee is for plain select mode: anywhere else a click already means something. */
  // Not on touch: there a drag is the only way to move the drawing, and a box
  // select has no finger equivalent. Tapping picks one panel at a time.
  const marqueeArmed =
    tool === 'select' && !calibration.active && !openingBrush && !spaceHeld && !coarsePointer;

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

  /**
   * The two-point flow: the first point anchors, the second commits.
   *
   * Still here alongside drag-to-draw because a press that never moved is a
   * tap, and tapping two corners is how this always worked on a desktop.
   */
  const placeAtNode = (node: GridPoint) => {
    if (!wallAnchor) {
      setWallAnchor(node);
      return;
    }
    if (tool === 'room') {
      buildRoom(wallAnchor, node);
      return;
    }
    const end = straightEnd(wallAnchor, node);
    if (end.x === wallAnchor.x && end.y === wallAnchor.y) {
      setWallAnchor(null);
      return;
    }
    autoFillRun(wallAnchor, end);
  };

  /**
   * Everything a press means before selection is considered: setting a
   * calibration point, anchoring or committing a wall run, dropping a single
   * panel. Returns true when it consumed the press.
   *
   * Shared by the mouse and the tap paths. Konva dispatches `mousedown` to a
   * mouse and `tap` to a finger and never both, so without one definition the
   * two would drift - and for most of this app's life the touch one simply
   * did not exist.
   */
  const placeAt = (point: { x: number; y: number }): boolean => {
    if (calibration.active) {
      // Unsnapped: a scan does not line up with the grid, which is exactly why
      // it needs calibrating in the first place.
      setCalibrationPoint({ x: point.x / PX_PER_UNIT, y: point.y / PX_PER_UNIT });
      return true;
    }

    if (drawingTool) {
      placeAtNode(nearestNode(point.x, point.y));
      return true;
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
        return true;
      }
      if (!isInsidePlot(plan.plot, candidate)) {
        notify('Panels must stay inside the plot boundary.', 'error');
        return true;
      }
      addPanels([candidate]);
      return true;
    }
    return false;
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
    updateDraw(point);
    if (marqueeStart.current) {
      const rect = rectBetween(marqueeStart.current, units);
      marqueeRect.current = rect;
      setMarquee(rect);
    }
  };

  /**
   * A tap, which on a touchscreen is what a click is on a desktop.
   *
   * It must be `tap` rather than `touchstart`: with the stage draggable, a
   * finger that moves pans the drawing, and Konva only fires `tap` when it
   * did not. So a drag moves the plan and a tap places - no mode toggle, and
   * the wall tool already worked by tapping twice.
   */
  /** A finger going down: in a drawing tool this opens a drag. */
  const handleTouchStart = (e: Konva.KonvaEventObject<TouchEvent>) => {
    lastTouchAt.current = Date.now();
    const stage = e.target.getStage();
    if (!stage || e.target !== stage) return;
    if (!drawingTool || calibration.active) return;
    const point = readPointer(stage);
    if (point) beginDraw(point);
  };

  const handleTouchEnd = () => {
    endPinch();
    finishDraw();
  };

  const handleTap = (e: Konva.KonvaEventObject<TouchEvent>) => {
    lastTouchAt.current = Date.now();
    const stage = e.target.getStage();
    if (!stage || e.target !== stage) return;
    // The drawing tools are driven by touchstart/touchend above; a tap there
    // would place a second time.
    if (drawingTool) return;
    const point = readPointer(stage);
    if (!point) return;

    // A finger cannot hover, so the previews have nothing to follow between
    // taps. Seeding them from the tap at least shows the anchor and the run
    // once the first point is down.
    setHoverRaw({ x: point.x / PX_PER_UNIT, y: point.y / PX_PER_UNIT });
    setHoverNode(nearestNode(point.x, point.y));
    setHoverEdge(nearestEdge(point.x, point.y));

    if (placeAt(point)) return;
    clearSelection();
  };

  /**
   * Two fingers: pinch to zoom and move to pan, in one gesture.
   *
   * The zoom is anchored on the midpoint between the fingers, so the drawing
   * grows around the gesture instead of sliding out from under it, and the
   * midpoint's own movement is added on as the pan. Konva would otherwise
   * keep dragging the stage with the first finger, so that drag is stopped
   * the moment a second one lands.
   */
  const handleTouchMove = (e: Konva.KonvaEventObject<TouchEvent>) => {
    lastTouchAt.current = Date.now();
    const stage = e.target.getStage();
    if (!stage) return;
    const pointers = stage.getPointersPositions();
    if (pointers.length < 2) {
      const point = readPointer(stage);
      if (point) {
        updateDraw(point);
        setHoverNode(nearestNode(point.x, point.y));
      }
      return;
    }
    // A second finger means the gesture was a pinch all along, not a wall.
    draw.current = null;
    setDrawPreview(null);

    if (e.evt.cancelable) e.evt.preventDefault();
    if (stage.isDragging()) stage.stopDrag();

    const [a, b] = pointers;
    const distance = pointerDistance(a, b);
    const mid = midpoint(a, b);
    const previous = pinch.current;
    pinch.current = { distance, mid };
    if (!previous) return;

    setViewport((current) => {
      const zoomed = zoomBy(current, mid, pinchFactor(previous.distance, distance));
      return {
        ...zoomed,
        x: zoomed.x + (mid.x - previous.mid.x),
        y: zoomed.y + (mid.y - previous.mid.y),
      };
    });
  };

  /** Lifting either finger ends the pinch; the next one starts a fresh span. */
  const endPinch = () => {
    pinch.current = null;
  };

  const GHOST_MOUSE_MS = 700;

  const handleMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (Date.now() - lastTouchAt.current < GHOST_MOUSE_MS) return;
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

    // A drawing tool waits for the release: a press that moves is a drag out
    // to the far corner, and one that does not is the first of two taps.
    if (drawingTool && !calibration.active) {
      beginDraw(point);
      return;
    }

    if (placeAt(point)) return;
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
        : drawingTool
          ? 'crosshair'
          : tool === 'select'
            ? 'default'
            : 'copy';

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full bg-white"
      // Without this the browser scrolls the page and zooms the whole document
      // instead of letting the drawing have the gesture.
      style={{ cursor, touchAction: 'none' }}
    >
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
        onMouseUp={() => {
          finishDraw();
          finishMarquee.current();
        }}
        onTap={handleTap}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
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
          {/* Named so the export can hide it. The grid is culled to the
              visible region, so at any other framing it would be drawn over
              only part of the picture - and a quote reads better without it. */}
          <Group name={EXPORT_HIDDEN}>
            <GridLayer
              bounds={visibleUnits(viewport, size.width, size.height)}
              scale={viewport.scale}
            />
          </Group>
          <PlotShape plot={plan.plot} scale={viewport.scale} unit={unit} />
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
              onHold={holdEnabled ? setHeldPanelId : undefined}
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
              onHold={holdEnabled ? setHeldPanelId : undefined}
              onMoved={movePanel}
            />
          ))}
        </Layer>

        <Layer listening={false}>
          <JunctionMarkers junctions={junctions} scale={viewport.scale} />
          <RunDimensions panels={linearPanels} scale={viewport.scale} unit={unit} />
          <UncoveredArea issues={validation.errors} scale={viewport.scale} />
          <MarqueeBox rect={marquee} scale={viewport.scale} />
          <IssueMarkers issues={validation.errors} scale={viewport.scale} />
          {tool === 'wall' && (
            <WallPreview
              anchor={drawPreview ? drawPreview.start : wallAnchor}
              cursor={drawPreview ? drawPreview.end : hoverNode}
              category={activeCategory}
              scale={viewport.scale}
              unit={unit}
            />
          )}
          {tool === 'room' && (
            <RoomPreview
              start={drawPreview ? drawPreview.start : wallAnchor}
              end={drawPreview ? drawPreview.end : hoverNode}
              category={activeCategory}
              scale={viewport.scale}
              unit={unit}
            />
          )}
          {/* Where the next point lands. Only while a drawing tool is armed:
              everywhere else it would be a ring following the cursor for no
              reason. */}
          {drawingTool && (
            <SnapRing
              node={drawPreview ? drawPreview.end : hoverNode}
              scale={viewport.scale}
            />
          )}
          <CalibrationOverlay
            from={calibration.active ? calibration.from : null}
            cursor={calibration.active ? hoverRaw : null}
            scale={viewport.scale}
            unit={unit}
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

      {/* Clear of the bottom sheet's handle, which owns the foot of the screen
          on anything narrower than a laptop. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between p-3 pb-16 text-xs lg:pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="pointer-events-auto rounded bg-slate-900/80 px-2 py-1 font-mono text-white">
            {hoverNode
              ? `${formatLength(unitsToFt(hoverNode.x), unit)}, ${formatLength(
                  unitsToFt(hoverNode.y),
                  unit,
                )}`
              : '—'}
          </span>
          <AreaReadout areas={areas} unit={unit} />
        </div>
        <span className="pointer-events-auto rounded bg-white/90 px-2 py-1 text-slate-600 ring-1 ring-slate-200">
          {coarsePointer
            ? drawingTool
              ? 'Drag to draw \u00b7 two fingers to pan and zoom'
              : 'Drag to pan \u00b7 pinch to zoom \u00b7 tap to place or select'
            : 'Scroll to zoom \u00b7 drag to select \u00b7 Space or middle-drag to pan'}
        </span>
      </div>

      {heldPanel && (
        <>
          <div
            className="absolute inset-0 z-40 bg-slate-900/30"
            onPointerDown={() => setHeldPanelId(null)}
          />
          <div
            className="absolute inset-x-0 bottom-0 z-40 rounded-t-2xl border-t border-slate-200 bg-white p-4 shadow-2xl"
            style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
          >
            <SlideToDelete
              label={`Delete this ${CATEGORY_STYLE[heldPanel.category].label.toLowerCase()}?`}
              onConfirm={() => {
                setHeldPanelId(null);
                deleteSelection();
              }}
              onCancel={() => setHeldPanelId(null)}
            />
          </div>
        </>
      )}

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
