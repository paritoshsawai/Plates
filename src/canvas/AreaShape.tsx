import { Rect } from 'react-konva';
import { AREA_DEPTH_UNITS, categoryColor, getPanelSpec } from '../core/panels';
import type { Panel } from '../core/types';
import { COLORS, PX_PER_UNIT, selectHandlers, snapToGrid } from './view';

interface Props {
  panel: Panel;
  selected: boolean;
  flagged: boolean;
  draggable: boolean;
  onSelect(id: string, additive: boolean): void;
  /** Touch only: the finger rested here, so offer the per-panel actions. */
  onHold?(id: string): void;
  onMoved(id: string, x: number, y: number): void;
}

/**
 * A floor or roof panel, drawn as the rectangle of cells it covers.
 *
 * These sit on their own plane beneath the walls and are kept translucent, so
 * the wall line - which is what the architect is actually drawing - stays the
 * thing you read first.
 */
export function AreaShape({ panel, selected, flagged, draggable, onSelect, onHold, onMoved }: Props) {
  const spec = getPanelSpec(panel.size);
  const widthUnits = panel.orientation === 'h' ? spec.widthUnits : AREA_DEPTH_UNITS;
  const heightUnits = panel.orientation === 'h' ? AREA_DEPTH_UNITS : spec.widthUnits;

  return (
    <Rect
      x={panel.x * PX_PER_UNIT}
      y={panel.y * PX_PER_UNIT}
      width={widthUnits * PX_PER_UNIT}
      height={heightUnits * PX_PER_UNIT}
      fill={flagged ? COLORS.error : categoryColor(panel.category)}
      opacity={flagged ? 0.45 : selected ? 0.55 : 0.28}
      stroke={selected ? COLORS.selection : '#ffffff'}
      strokeWidth={selected ? 2.5 : 1}
      draggable={draggable}
      dragBoundFunc={snapToGrid}
      {...selectHandlers(
        (additive) => onSelect(panel.id, additive),
        onHold ? () => onHold(panel.id) : undefined,
      )}
      onDragEnd={(e) => {
        const node = e.target;
        onMoved(panel.id, Math.round(node.x() / PX_PER_UNIT), Math.round(node.y() / PX_PER_UNIT));
      }}
      perfectDrawEnabled={false}
    />
  );
}
