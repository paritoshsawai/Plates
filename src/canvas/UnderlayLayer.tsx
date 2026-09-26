import { useEffect, useState } from 'react';
import { Circle, Image as KonvaImage, Line, Text } from 'react-konva';
import { GRID_FT, formatLength } from '../core/units';
import type { LengthUnit } from '../core/units';
import type { GridPoint, Underlay } from '../core/types';
import { COLORS, PX_PER_UNIT } from './view';

/** Load the underlay's data URL into an element Konva can draw. */
function useImageElement(dataUrl: string | undefined): HTMLImageElement | null {
  const [element, setElement] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!dataUrl) {
      setElement(null);
      return;
    }
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (!cancelled) setElement(image);
    };
    image.src = dataUrl;
    return () => {
      cancelled = true;
    };
  }, [dataUrl]);

  return element;
}

interface Props {
  underlay: Underlay | undefined;
}

/**
 * The scanned plan, drawn beneath the grid.
 *
 * It never takes pointer events: the underlay is a reference to trace over,
 * and a stray click on it must reach the drawing tools underneath.
 */
export function UnderlayLayer({ underlay }: Props) {
  const image = useImageElement(underlay?.dataUrl);
  if (!underlay || !image) return null;

  return (
    <KonvaImage
      image={image}
      x={underlay.x * PX_PER_UNIT}
      y={underlay.y * PX_PER_UNIT}
      width={image.naturalWidth * underlay.scale * PX_PER_UNIT}
      height={image.naturalHeight * underlay.scale * PX_PER_UNIT}
      opacity={underlay.opacity}
      listening={false}
    />
  );
}

interface CalibrationProps {
  from: GridPoint | null;
  cursor: GridPoint | null;
  scale: number;
  unit: LengthUnit;
}

/**
 * The two-point measuring line used to tell the app how big the scan is.
 * Shows the distance in the plan's own units as it is dragged, so the
 * architect can see what they are about to declare.
 */
export function CalibrationOverlay({ from, cursor, scale, unit }: CalibrationProps) {
  if (!from) return null;
  const fontSize = Math.max(9, 12 / scale);

  return (
    <>
      <Circle
        x={from.x * PX_PER_UNIT}
        y={from.y * PX_PER_UNIT}
        radius={Math.max(3, 5 / scale)}
        fill={COLORS.anchor}
        listening={false}
      />
      {cursor && (
        <>
          <Line
            points={[
              from.x * PX_PER_UNIT,
              from.y * PX_PER_UNIT,
              cursor.x * PX_PER_UNIT,
              cursor.y * PX_PER_UNIT,
            ]}
            stroke={COLORS.anchor}
            strokeWidth={Math.max(1.5, 2 / scale)}
            listening={false}
          />
          <Circle
            x={cursor.x * PX_PER_UNIT}
            y={cursor.y * PX_PER_UNIT}
            radius={Math.max(3, 5 / scale)}
            fill={COLORS.anchor}
            listening={false}
          />
          <Text
            x={((from.x + cursor.x) / 2) * PX_PER_UNIT - 60}
            y={((from.y + cursor.y) / 2) * PX_PER_UNIT - fontSize * 2}
            width={120}
            align="center"
            text={`${formatLength(
              Math.hypot(cursor.x - from.x, cursor.y - from.y) * GRID_FT,
              unit,
            )} at current scale`}
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
      )}
    </>
  );
}
