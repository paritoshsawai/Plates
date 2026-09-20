import { useCallback } from 'react';
import { Group, Rect } from 'react-konva';
import type Konva from 'konva';
import { categoryColor, getPanelSpec } from '../core/panels';
import type { Panel } from '../core/types';
import { COLORS, PX_PER_UNIT, WALL_PX } from './view';

interface Props {
  panel: Panel;
  selected: boolean;
  flagged: boolean;
  draggable: boolean;
  onSelect(id: string, additive: boolean): void;
  onMoved(id: string, x: number, y: number): void;
}

/** Extra transparent padding so a 9 px wall is still easy to grab. */
const HIT_PAD = 7;

export function PanelShape({ panel, selected, flagged, draggable, onSelect, onMoved }: Props) {
  const spec = getPanelSpec(panel.size);
  const runPx = spec.widthUnits * PX_PER_UNIT;

  const width = panel.orientation === 'h' ? runPx : WALL_PX;
  const height = panel.orientation === 'h' ? WALL_PX : runPx;
  const offsetX = panel.orientation === 'h' ? 0 : WALL_PX / 2;
  const offsetY = panel.orientation === 'h' ? WALL_PX / 2 : 0;

  // Live-snap the drag to the 2 ft grid. Konva hands us absolute stage
  // coordinates, so undo the stage transform, snap in world space, redo it.
  const dragBoundFunc = useCallback(
    function (this: Konva.Node, pos: Konva.Vector2d): Konva.Vector2d {
      const stage = this.getStage();
      if (!stage) return pos;
      const scale = stage.scaleX() || 1;
      const originX = stage.x();
      const originY = stage.y();
      const worldX = (pos.x - originX) / scale;
      const worldY = (pos.y - originY) / scale;
      const snappedX = Math.round(worldX / PX_PER_UNIT) * PX_PER_UNIT;
      const snappedY = Math.round(worldY / PX_PER_UNIT) * PX_PER_UNIT;
      return { x: snappedX * scale + originX, y: snappedY * scale + originY };
    },
    [],
  );

  const fill = flagged ? COLORS.error : categoryColor(panel.category);

  return (
    <Group
      x={panel.x * PX_PER_UNIT}
      y={panel.y * PX_PER_UNIT}
      draggable={draggable}
      dragBoundFunc={dragBoundFunc}
      onMouseDown={(e) => {
        e.cancelBubble = true;
        onSelect(panel.id, e.evt.shiftKey);
      }}
      onDragEnd={(e) => {
        const node = e.target;
        onMoved(
          panel.id,
          Math.round(node.x() / PX_PER_UNIT),
          Math.round(node.y() / PX_PER_UNIT),
        );
      }}
    >
      <Rect
        x={-offsetX - HIT_PAD}
        y={-offsetY - HIT_PAD}
        width={width + HIT_PAD * 2}
        height={height + HIT_PAD * 2}
        fill="transparent"
      />
      <Rect
        x={-offsetX}
        y={-offsetY}
        width={width}
        height={height}
        fill={fill}
        stroke={selected ? COLORS.selection : '#ffffff'}
        strokeWidth={selected ? 2.5 : 1}
        cornerRadius={1.5}
        shadowColor={selected ? COLORS.selection : undefined}
        shadowBlur={selected ? 8 : 0}
        shadowOpacity={selected ? 0.5 : 0}
        perfectDrawEnabled={false}
      />
    </Group>
  );
}
