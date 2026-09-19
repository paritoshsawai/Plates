import { Line } from 'react-konva';
import { COLORS, PX_PER_UNIT } from './view';

/** Every 5th line is heavier: 5 units = 10 ft. */
const MAJOR_EVERY = 5;

interface Props {
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  scale: number;
}

export function GridLayer({ bounds, scale }: Props) {
  const lines = [];
  const thin = Math.max(0.4, 1 / scale);
  // Below this zoom the 2 ft lines turn into a grey wash; drop them and keep
  // the 10 ft lines as the reference.
  const showMinor = scale > 0.45;

  for (let x = bounds.minX; x <= bounds.maxX; x++) {
    const major = x % MAJOR_EVERY === 0;
    if (!major && !showMinor) continue;
    lines.push(
      <Line
        key={`v${x}`}
        points={[x * PX_PER_UNIT, bounds.minY * PX_PER_UNIT, x * PX_PER_UNIT, bounds.maxY * PX_PER_UNIT]}
        stroke={major ? COLORS.gridMajor : COLORS.gridMinor}
        strokeWidth={major ? thin * 1.5 : thin}
        listening={false}
        perfectDrawEnabled={false}
      />,
    );
  }
  for (let y = bounds.minY; y <= bounds.maxY; y++) {
    const major = y % MAJOR_EVERY === 0;
    if (!major && !showMinor) continue;
    lines.push(
      <Line
        key={`h${y}`}
        points={[bounds.minX * PX_PER_UNIT, y * PX_PER_UNIT, bounds.maxX * PX_PER_UNIT, y * PX_PER_UNIT]}
        stroke={major ? COLORS.gridMajor : COLORS.gridMinor}
        strokeWidth={major ? thin * 1.5 : thin}
        listening={false}
        perfectDrawEnabled={false}
      />,
    );
  }

  return <>{lines}</>;
}
