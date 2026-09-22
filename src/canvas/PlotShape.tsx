import { Fragment } from 'react';
import { Line, Text } from 'react-konva';
import { plotEdgeLengthsFt } from '../core/plot';
import { formatFt } from '../core/units';
import type { Plot } from '../core/types';
import { COLORS, PX_PER_UNIT } from './view';

interface Props {
  plot: Plot;
  scale: number;
}

/** The parcel: a filled rectilinear ring with each edge dimensioned in feet. */
export function PlotShape({ plot, scale }: Props) {
  const points = plot.vertices.flatMap((v) => [v.x * PX_PER_UNIT, v.y * PX_PER_UNIT]);
  const lengths = plotEdgeLengthsFt(plot);
  const fontSize = Math.max(9, 12 / scale);

  return (
    <>
      <Line
        points={points}
        closed
        fill={COLORS.plotFill}
        stroke={COLORS.plotStroke}
        strokeWidth={Math.max(1, 2 / scale)}
        dash={[8 / scale, 5 / scale]}
        listening={false}
      />
      {plot.vertices.map((vertex, i) => {
        const next = plot.vertices[(i + 1) % plot.vertices.length];
        const midX = ((vertex.x + next.x) / 2) * PX_PER_UNIT;
        const midY = ((vertex.y + next.y) / 2) * PX_PER_UNIT;
        const horizontal = vertex.y === next.y;
        return (
          <Fragment key={`edge-${i}`}>
            <Text
              x={horizontal ? midX - 40 : midX + 6}
              y={midY - (horizontal ? fontSize * 1.6 : fontSize / 2)}
              width={80}
              align={horizontal ? 'center' : 'left'}
              text={formatFt(lengths[i])}
              fontSize={fontSize}
              fontFamily="ui-monospace, monospace"
              fill={COLORS.plotStroke}
              stroke="#ffffff"
              strokeWidth={Math.max(2, 3 / scale)}
              fillAfterStrokeEnabled
              listening={false}
            />
          </Fragment>
        );
      })}
    </>
  );
}
