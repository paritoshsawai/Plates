/**
 * Turns a set of placed panels into the discrete wall graph everything else
 * reasons about: which 2 ft edges are occupied, which nodes they meet at, and
 * which maximal straight runs they form.
 *
 * Corner convention: panels own *edges*, junctions are dimensionless *nodes*.
 * Two walls meeting at a corner each stop at the shared node, so a corner is
 * never covered twice and never counted twice in the BOM.
 */

import { edgeKey, nodeKey, panelEdges, panelEndNode } from './panels';
import type { GridEdge, GridPoint, Panel } from './types';

export interface EdgeIndex {
  /** edgeKey -> ids of every panel claiming that edge. Length > 1 is an overlap. */
  byEdge: Map<string, string[]>;
  /** edgeKey -> the edge itself, for reporting. */
  edges: Map<string, GridEdge>;
}

export function buildEdgeIndex(panels: Panel[]): EdgeIndex {
  const byEdge = new Map<string, string[]>();
  const edges = new Map<string, GridEdge>();
  for (const panel of panels) {
    for (const edge of panelEdges(panel)) {
      const key = edgeKey(edge);
      edges.set(key, edge);
      const claimants = byEdge.get(key);
      if (claimants) claimants.push(panel.id);
      else byEdge.set(key, [panel.id]);
    }
  }
  return { byEdge, edges };
}

/** Which way an occupied edge leaves a node. */
export type Direction = 'north' | 'south' | 'east' | 'west';

export interface NodeInfo {
  point: GridPoint;
  /** Number of distinct occupied edges incident to this node. */
  degree: number;
  /**
   * The directions those edges leave in. Degree alone cannot tell a corner
   * from a straight run - both are 2 - so the junction classifier needs these.
   */
  directions: Set<Direction>;
  /** Panels touching this node, for highlighting. */
  panelIds: Set<string>;
}

/**
 * Degree of every node touched by a wall.
 *
 * Degree 1 is a dangling wall end - the plan has a hole in it. Degree 2 is a
 * straight continuation or a corner, 3 a T-junction, 4 a crossing. This one
 * number is the whole gap check.
 */
export function buildNodeIndex(panels: Panel[], index: EdgeIndex): Map<string, NodeInfo> {
  const nodes = new Map<string, NodeInfo>();

  const touch = (
    x: number,
    y: number,
    panelId: string,
    direction: Direction | null,
  ) => {
    const key = nodeKey(x, y);
    let info = nodes.get(key);
    if (!info) {
      info = { point: { x, y }, degree: 0, directions: new Set(), panelIds: new Set() };
      nodes.set(key, info);
    }
    if (direction) {
      info.degree += 1;
      info.directions.add(direction);
    }
    info.panelIds.add(panelId);
  };

  // Degree counts distinct occupied edges, so overlapping duplicates do not
  // inflate it and mask an open end.
  for (const [key, claimants] of index.byEdge) {
    const edge = index.edges.get(key)!;
    const owner = claimants[0];
    if (edge.axis === 'h') {
      // The edge runs east from (x, y) and arrives from the west at (x+1, y).
      touch(edge.x, edge.y, owner, 'east');
      touch(edge.x + 1, edge.y, owner, 'west');
    } else {
      touch(edge.x, edge.y, owner, 'south');
      touch(edge.x, edge.y + 1, owner, 'north');
    }
  }

  // Attribute every panel to the nodes it spans, so an issue at a node can
  // highlight all the panels a user would need to look at.
  for (const panel of panels) {
    touch(panel.x, panel.y, panel.id, null);
    const end = panelEndNode(panel);
    touch(end.x, end.y, panel.id, null);
  }

  return nodes;
}

export interface WallRun {
  x: number;
  y: number;
  axis: 'h' | 'v';
  lengthUnits: number;
}

/**
 * Maximal straight runs of consecutive occupied edges. A run may pass through a
 * T-junction, because a real panel can span one; that keeps the "fewest panels
 * for this geometry" baseline honest.
 */
export function collinearRuns(index: EdgeIndex): WallRun[] {
  const lines = new Map<string, number[]>();
  for (const edge of index.edges.values()) {
    const lineKey = edge.axis === 'h' ? `h:${edge.y}` : `v:${edge.x}`;
    const along = edge.axis === 'h' ? edge.x : edge.y;
    const list = lines.get(lineKey);
    if (list) list.push(along);
    else lines.set(lineKey, [along]);
  }

  const runs: WallRun[] = [];
  for (const [lineKey, positions] of lines) {
    const [axisTag, coordText] = lineKey.split(':');
    const axis = axisTag as 'h' | 'v';
    const coord = Number(coordText);
    positions.sort((a, b) => a - b);

    let start = positions[0];
    let prev = positions[0];
    for (let i = 1; i <= positions.length; i++) {
      const current = positions[i];
      if (i === positions.length || current !== prev + 1) {
        const lengthUnits = prev - start + 1;
        runs.push(
          axis === 'h'
            ? { x: start, y: coord, axis, lengthUnits }
            : { x: coord, y: start, axis, lengthUnits },
        );
        start = current;
      }
      prev = current;
    }
  }
  return runs;
}

/** Number of connected wall structures. More than one means detached buildings. */
export function countComponents(index: EdgeIndex): number {
  const parent = new Map<string, string>();
  const find = (a: string): string => {
    let root = a;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let cursor = a;
    while (parent.get(cursor) !== root) {
      const next = parent.get(cursor)!;
      parent.set(cursor, root);
      cursor = next;
    }
    return root;
  };
  const add = (key: string) => {
    if (!parent.has(key)) parent.set(key, key);
  };
  const union = (a: string, b: string) => {
    add(a);
    add(b);
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  for (const edge of index.edges.values()) {
    const a = nodeKey(edge.x, edge.y);
    const b = edge.axis === 'h' ? nodeKey(edge.x + 1, edge.y) : nodeKey(edge.x, edge.y + 1);
    union(a, b);
  }

  const roots = new Set<string>();
  for (const key of parent.keys()) roots.add(find(key));
  return roots.size;
}

/** Total wall length in grid units, counting each occupied edge once. */
export function coveredEdgeCount(index: EdgeIndex): number {
  return index.edges.size;
}
