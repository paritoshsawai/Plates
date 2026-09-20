import { Fragment } from 'react';
import { Circle, Line, Rect, Text } from 'react-konva';
import { buildEdgeIndex, collinearRuns } from '../core/walls';
import { minPanelCount, tilingSequence } from '../core/tiling';
import { categoryColor, getPanelSpec } from '../core/panels';
import { formatFt, unitsToFt } from '../core/units';
import type { GridPoint, Panel, PanelCategory, PanelSizeId, ValidationIssue } from '../core/types';
import type { Junction } from '../core/junctions';
import { COLORS, PX_PER_UNIT, WALL_PX } from './view';

interface DimensionProps {
  panels: Panel[];
  scale: number;
}

/**
 * A length label on every straight wall run, so the architect reads real
 * dimensions without measuring. Runs shorter than 2 units are left unlabelled;
 * the label would be wider than the wall.
 */
export function RunDimensions({ panels, scale }: DimensionProps) {
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
            text={formatFt(unitsToFt(run.lengthUnits))}
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
}

/**
 * Live preview of the wall tool: the minimum-panel tiling that will be laid,
 * drawn panel by panel with its length and panel count. The architect sees the
 * BOM consequence of the wall before committing to it.
 */
export function WallPreview({ anchor, cursor, category, scale }: PreviewProps) {
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
            text={`${formatFt(unitsToFt(lengthUnits))} · ${minPanelCount(lengthUnits) ?? '?'} panels`}
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
