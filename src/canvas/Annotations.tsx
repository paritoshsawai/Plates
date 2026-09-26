import { Fragment } from 'react';
import { Circle, Line, Rect, Text } from 'react-konva';
import { buildEdgeIndex, collinearRuns } from '../core/walls';
import { minPanelCount, tilingSequence } from '../core/tiling';
import { categoryColor, getPanelSpec } from '../core/panels';
import { formatLength, unitsToFt } from '../core/units';
import type { LengthUnit } from '../core/units';
import type { GridPoint, Panel, PanelCategory, PanelSizeId, ValidationIssue } from '../core/types';
import type { Junction } from '../core/junctions';
import { COLORS, PX_PER_UNIT, WALL_PX } from './view';

interface DimensionProps {
  panels: Panel[];
  scale: number;
  unit: LengthUnit;
}

/**
 * A length label on every straight wall run, so the architect reads real
 * dimensions without measuring. Runs shorter than 2 units are left unlabelled;
 * the label would be wider than the wall.
 */
export function RunDimensions({ panels, scale, unit }: DimensionProps) {
  const runs = collinearRuns(buildEdgeIndex(panels));
  const fontSize = Math.max(8, 11 / scale);

  return (
    <>
      {runs.map((run, i) => {
        if (run.lengthUnits < 2) return null;
        const midAlong = (run.axis === 'h' ? run.x : run.y) + run.lengthUnits / 2;
        // Horizontal runs take the label above the wall; vertical runs take it
        // to the right, so the text never sits on top of the panels.
        const horizontal = run.axis === 'h';
        const x = horizontal ? midAlong * PX_PER_UNIT - 36 : run.x * PX_PER_UNIT + WALL_PX;
        const y = horizontal
          ? run.y * PX_PER_UNIT - (fontSize + WALL_PX)
          : midAlong * PX_PER_UNIT - fontSize / 2;
        return (
          <Text
            key={`run-${i}`}
            x={x}
            y={y}
            width={72}
            align={horizontal ? 'center' : 'left'}
            text={formatLength(unitsToFt(run.lengthUnits), unit)}
            fontSize={fontSize}
            fontStyle="bold"
            fontFamily="ui-monospace, monospace"
            fill={COLORS.label}
            // A white halo keeps the dimension readable where it crosses a
            // wall, which happens at every partition and corner.
            stroke="#ffffff"
            strokeWidth={Math.max(2, 3 / scale)}
            fillAfterStrokeEnabled
            listening={false}
          />
        );
      })}
    </>
  );
}

interface IssueProps {
  issues: ValidationIssue[];
  scale: number;
}

/** A ring at each dangling wall end - the plan's gaps, shown where they are. */
export function IssueMarkers({ issues, scale }: IssueProps) {
  return (
    <>
      {issues
        .filter((issue) => issue.at)
        .map((issue, i) => (
          <Circle
            key={`issue-${i}`}
            x={issue.at!.x * PX_PER_UNIT}
            y={issue.at!.y * PX_PER_UNIT}
            radius={Math.max(5, 8 / scale)}
            stroke={COLORS.error}
            strokeWidth={Math.max(1.5, 2.5 / scale)}
            listening={false}
          />
        ))}
    </>
  );
}

interface UncoveredProps {
  issues: ValidationIssue[];
  scale: number;
}

/**
 * Shade the cells a floor or roof does not reach.
 *
 * The message already gives the area in square feet; this says *where*, which
 * is the part that tells an architect which dimension to change.
 */
export function UncoveredArea({ issues, scale }: UncoveredProps) {
  const cells = issues.flatMap((issue) => issue.cells ?? []);
  if (cells.length === 0) return null;

  return (
    <>
      {cells.map((cell, i) => (
        <Rect
          key={`uncovered-${i}`}
          x={cell.x * PX_PER_UNIT}
          y={cell.y * PX_PER_UNIT}
          width={PX_PER_UNIT}
          height={PX_PER_UNIT}
          fill={COLORS.error}
          opacity={0.18}
          stroke={COLORS.error}
          strokeWidth={Math.max(0.4, 0.75 / scale)}
          listening={false}
        />
      ))}
    </>
  );
}

interface MarqueeProps {
  rect: { x: number; y: number; width: number; height: number } | null;
  scale: number;
}

/** The rubber-band selection box. */
export function MarqueeBox({ rect, scale }: MarqueeProps) {
  if (!rect) return null;
  return (
    <Rect
      x={rect.x * PX_PER_UNIT}
      y={rect.y * PX_PER_UNIT}
      width={rect.width * PX_PER_UNIT}
      height={rect.height * PX_PER_UNIT}
      fill={COLORS.selection}
      opacity={0.12}
      stroke={COLORS.selection}
      strokeWidth={Math.max(1, 1.5 / scale)}
      dash={[5 / scale, 3 / scale]}
      listening={false}
    />
  );
}

interface JunctionProps {
  junctions: Junction[];
  scale: number;
}

/**
 * A small square post at every detected junction. These are real, separately
 * priced components, so showing them keeps the drawing honest about what the
 * BOM is billing for.
 */
export function JunctionMarkers({ junctions, scale }: JunctionProps) {
  const size = Math.max(5, WALL_PX * 1.3);
  return (
    <>
      {junctions.map((junction, i) => (
        <Rect
          key={`junction-${i}`}
          x={junction.at.x * PX_PER_UNIT - size / 2}
          y={junction.at.y * PX_PER_UNIT - size / 2}
          width={size}
          height={size}
          fill={COLORS.connector}
          stroke="#ffffff"
          strokeWidth={Math.max(0.75, 1 / scale)}
          listening={false}
        />
      ))}
    </>
  );
}

interface PreviewProps {
  anchor: GridPoint | null;
  cursor: GridPoint | null;
  category: PanelCategory;
  scale: number;
  unit: LengthUnit;
}

/**
 * Live preview of the wall tool: the minimum-panel tiling that will be laid,
 * drawn panel by panel with its length and panel count. The architect sees the
 * BOM consequence of the wall before committing to it.
 */
export function WallPreview({ anchor, cursor, category, scale, unit }: PreviewProps) {
  if (!anchor) return null;

  if (!cursor) {
    return (
      <Circle
        x={anchor.x * PX_PER_UNIT}
        y={anchor.y * PX_PER_UNIT}
        radius={Math.max(3, 5 / scale)}
        fill={COLORS.anchor}
        listening={false}
      />
    );
  }

  const dx = cursor.x - anchor.x;
  const dy = cursor.y - anchor.y;
  // Constrain the preview to the dominant axis: walls run straight.
  const axis: 'h' | 'v' = Math.abs(dx) >= Math.abs(dy) ? 'h' : 'v';
  const lengthUnits = axis === 'h' ? Math.abs(dx) : Math.abs(dy);
  const start =
    axis === 'h'
      ? { x: Math.min(anchor.x, cursor.x), y: anchor.y }
      : { x: anchor.x, y: Math.min(anchor.y, cursor.y) };

  const sequence = lengthUnits > 0 ? tilingSequence(lengthUnits) : [];
  const fontSize = Math.max(9, 12 / scale);
  let cursorUnits = 0;

  return (
    <>
      <Circle
        x={anchor.x * PX_PER_UNIT}
        y={anchor.y * PX_PER_UNIT}
        radius={Math.max(3, 5 / scale)}
        fill={COLORS.anchor}
        listening={false}
      />
      {(sequence ?? []).map((size, i) => {
        const spec = getPanelSpec(size);
        const runPx = spec.widthUnits * PX_PER_UNIT;
        const px = (axis === 'h' ? start.x + cursorUnits : start.x) * PX_PER_UNIT;
        const py = (axis === 'h' ? start.y : start.y + cursorUnits) * PX_PER_UNIT;
        cursorUnits += spec.widthUnits;
        return (
          <Rect
            key={`ghost-${i}`}
            x={axis === 'h' ? px : px - WALL_PX / 2}
            y={axis === 'h' ? py - WALL_PX / 2 : py}
            width={axis === 'h' ? runPx : WALL_PX}
            height={axis === 'h' ? WALL_PX : runPx}
            fill={categoryColor(category)}
            opacity={0.45}
            stroke="#ffffff"
            strokeWidth={1}
            listening={false}
          />
        );
      })}
      {lengthUnits > 0 && (
        <Fragment>
          <Line
            points={[
              anchor.x * PX_PER_UNIT,
              anchor.y * PX_PER_UNIT,
              axis === 'h' ? cursor.x * PX_PER_UNIT : anchor.x * PX_PER_UNIT,
              axis === 'h' ? anchor.y * PX_PER_UNIT : cursor.y * PX_PER_UNIT,
            ]}
            stroke={COLORS.anchor}
            strokeWidth={Math.max(1, 1.5 / scale)}
            dash={[6 / scale, 4 / scale]}
            listening={false}
          />
          <Text
            x={((axis === 'h' ? start.x + lengthUnits / 2 : start.x) * PX_PER_UNIT) - 60}
            y={((axis === 'h' ? start.y : start.y + lengthUnits / 2) * PX_PER_UNIT) - fontSize * 2.2}
            width={120}
            align="center"
            text={`${formatLength(unitsToFt(lengthUnits), unit)} · ${
              minPanelCount(lengthUnits) ?? '?'
            } panels`}
            fontSize={fontSize}
            fontStyle="bold"
            fontFamily="ui-monospace, monospace"
            fill={COLORS.anchor}
            stroke="#ffffff"
            strokeWidth={Math.max(2, 3 / scale)}
            fillAfterStrokeEnabled
            listening={false}
          />
        </Fragment>
      )}
    </>
  );
}

interface BrushProps {
  edge: { x: number; y: number; axis: 'h' | 'v' } | null;
  size: PanelSizeId;
  category: PanelCategory;
  scale: number;
}

/** Ghost of the single panel the place tool would drop at the cursor. */
export function BrushPreview({ edge, size, category, scale }: BrushProps) {
  if (!edge) return null;
  const spec = getPanelSpec(size);
  const runPx = spec.widthUnits * PX_PER_UNIT;
  const px = edge.x * PX_PER_UNIT;
  const py = edge.y * PX_PER_UNIT;
  return (
    <Rect
      x={edge.axis === 'h' ? px : px - WALL_PX / 2}
      y={edge.axis === 'h' ? py - WALL_PX / 2 : py}
      width={edge.axis === 'h' ? runPx : WALL_PX}
      height={edge.axis === 'h' ? WALL_PX : runPx}
      fill={categoryColor(category)}
      opacity={0.4}
      stroke={COLORS.ghost}
      strokeWidth={Math.max(1, 1 / scale)}
      listening={false}
    />
  );
}

/**
 * The room tool's live rectangle: four runs, their dimensions and the panel
 * count, before anything is committed.
 */
export function RoomPreview({
  start,
  end,
  category,
  scale,
  unit,
}: {
  start: GridPoint | null;
  end: GridPoint | null;
  category: PanelCategory;
  scale: number;
  unit: LengthUnit;
}) {
  if (!start || !end) return null;
  const minX = Math.min(start.x, end.x);
  const maxX = Math.max(start.x, end.x);
  const minY = Math.min(start.y, end.y);
  const maxY = Math.max(start.y, end.y);
  const widthUnits = maxX - minX;
  const depthUnits = maxY - minY;
  if (widthUnits === 0 || depthUnits === 0) return null;

  const colour = categoryColor(category);
  const fontSize = Math.max(9, 12 / scale);
  const panels =
    2 * ((minPanelCount(widthUnits) ?? 0) + (minPanelCount(depthUnits) ?? 0));

  return (
    <>
      <Rect
        x={minX * PX_PER_UNIT}
        y={minY * PX_PER_UNIT}
        width={widthUnits * PX_PER_UNIT}
        height={depthUnits * PX_PER_UNIT}
        fill={colour}
        opacity={0.12}
        stroke={colour}
        strokeWidth={Math.max(2, WALL_PX / 2 / scale)}
        listening={false}
      />
      <Text
        x={(minX + widthUnits / 2) * PX_PER_UNIT - 90}
        y={minY * PX_PER_UNIT - fontSize * 2}
        width={180}
        align="center"
        text={`${formatLength(unitsToFt(widthUnits), unit)} × ${formatLength(
          unitsToFt(depthUnits),
          unit,
        )} · ${panels} panels`}
        fontSize={fontSize}
        fontStyle="bold"
        fontFamily="ui-monospace, monospace"
        fill={COLORS.anchor}
        stroke="#ffffff"
        strokeWidth={Math.max(2, 3 / scale)}
        fillAfterStrokeEnabled
        listening={false}
      />
    </>
  );
}

/**
 * A ring on the grid node a press will actually land on.
 *
 * The fix for the complaint that started this: on a phone one 2 ft step can be
 * a handful of pixels, so a fingertip covers several of them and you cannot
 * tell which one you are about to take. Showing the answer, large, before the
 * finger lifts turns guesswork into aiming.
 */
export function SnapRing({ node, scale }: { node: GridPoint | null; scale: number }) {
  if (!node) return null;
  const radius = Math.max(9, 14 / scale);
  return (
    <>
      <Circle
        x={node.x * PX_PER_UNIT}
        y={node.y * PX_PER_UNIT}
        radius={radius}
        stroke={COLORS.anchor}
        strokeWidth={Math.max(1.5, 2.5 / scale)}
        listening={false}
      />
      <Circle
        x={node.x * PX_PER_UNIT}
        y={node.y * PX_PER_UNIT}
        radius={Math.max(2, 3 / scale)}
        fill={COLORS.anchor}
        listening={false}
      />
    </>
  );
}
