/**
 * Junction hardware, derived from the wall layout.
 *
 * Real panel systems need a dedicated connector wherever wall runs meet: a
 * corner post in the foam recess at a 90 degree turn, a T-section detail where
 * a partition lands on another wall, and so on. Those are separately priced
 * components, so the tool counts them rather than leaving it to the architect -
 * exactly the bookkeeping a manual process gets wrong.
 *
 * This also settles the MVP's open corner convention: wall panels count wall
 * material only, and junction hardware is its own BOM line. Nothing is ever
 * counted twice, because panels own edges and connectors own nodes.
 */

import { isLinearCategory } from './types';
import { buildEdgeIndex, buildNodeIndex } from './walls';
import type { Direction, NodeInfo } from './walls';
import type { ConnectorType, GridPoint, Panel } from './types';

export interface Junction {
  type: ConnectorType;
  at: GridPoint;
  /** Panels meeting here, so the canvas can highlight them. */
  panelIds: string[];
}

/**
 * What a node needs, from the directions its walls leave in.
 *
 * Degree 1 is a dangling wall end: it needs no connector, and it stays a
 * blocking validation error rather than becoming a warning - a hole in a wall
 * must not read as manufacturable.
 *
 * Degree 2 is the case degree alone cannot settle. Two edges on the same axis
 * are a straight run carrying on through the node, which needs nothing; two on
 * different axes are a 90 degree turn, which needs a corner post.
 */
export function classifyNode(info: NodeInfo): ConnectorType | null {
  const has = (direction: Direction) => info.directions.has(direction);
  switch (info.degree) {
    case 4:
      return 'cross';
    case 3:
      return 't-junction';
    case 2: {
      const straight = (has('east') && has('west')) || (has('north') && has('south'));
      return straight ? null : 'corner';
    }
    default:
      // 0 is unreachable (a node exists only because an edge touches it) and 1
      // is an open end, handled by validation.
      return null;
  }
}

/**
 * Every connector the layout needs. Only linear categories take part: a floor
 * or roof panel lying inside the envelope does not create a wall junction.
 */
export function detectJunctions(panels: Panel[]): Junction[] {
  const linear = panels.filter((panel) => isLinearCategory(panel.category));
  if (linear.length === 0) return [];

  const index = buildEdgeIndex(linear);
  const nodes = buildNodeIndex(linear, index);

  const junctions: Junction[] = [];
  for (const info of nodes.values()) {
    const type = classifyNode(info);
    if (type) junctions.push({ type, at: info.point, panelIds: [...info.panelIds] });
  }

  // Stable order so the BOM and any export diff cleanly between runs.
  junctions.sort((a, b) => a.at.y - b.at.y || a.at.x - b.at.x);
  return junctions;
}

export function countJunctions(panels: Panel[]): Record<ConnectorType, number> {
  const counts: Record<ConnectorType, number> = {
    corner: 0,
    't-junction': 0,
    cross: 0,
  };
  for (const junction of detectJunctions(panels)) counts[junction.type] += 1;
  return counts;
}
