/**
 * The validation engine. A plan is manufacturable only when every wall is
 * covered edge to edge with no gaps, no overlaps, and nothing outside the plot.
 *
 * Because panels live on an integer 2 ft grid, all of that is integer
 * bookkeeping over the wall graph - no floating-point tolerances, no
 * near-miss geometry.
 */

import { cellKey, isKnownCategory, isKnownPanelSize, panelCells, panelEdges, panelEndNode } from './panels';
import { containsPoint, containsSegment } from './plot';
import { interiorCells } from './footprint';
import { isLinearCategory } from './types';
import { AREA_CATEGORIES } from './types';
import { unitsToFt } from './units';
import { buildEdgeIndex, buildNodeIndex, countComponents } from './walls';
import type { Panel, PanelCategory, Plot, ValidationIssue, ValidationResult } from './types';

function emptyResult(issues: ValidationIssue[], manufacturable: boolean): ValidationResult {
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  const flaggedPanelIds = new Set<string>();
  for (const issue of errors) for (const id of issue.panelIds) flaggedPanelIds.add(id);
  return { issues, errors, warnings, manufacturable, flaggedPanelIds };
}

export function validatePlan(panels: Panel[], plot: Plot): ValidationResult {
  const issues: ValidationIssue[] = [];

  if (panels.length === 0) {
    issues.push({
      code: 'empty-plan',
      severity: 'warning',
      message: 'No panels placed yet. Draw a wall to begin.',
      panelIds: [],
    });
    return emptyResult(issues, false);
  }

  // 1. Integrity of the panels themselves. Placement cannot produce these, but
  //    an imported or hand-edited plan JSON can.
  for (const panel of panels) {
    if (!isKnownPanelSize(panel.size)) {
      issues.push({
        code: 'unknown-panel',
        severity: 'error',
        message: `Panel ${panel.id} is size "${panel.size}", which Arplace does not manufacture.`,
        panelIds: [panel.id],
      });
      continue;
    }
    if (!isKnownCategory(panel.category)) {
      issues.push({
        code: 'unknown-panel',
        severity: 'error',
        message: `Panel ${panel.id} has category "${panel.category}", which is not a known category.`,
        panelIds: [panel.id],
      });
      continue;
    }
    if (!Number.isInteger(panel.x) || !Number.isInteger(panel.y)) {
      issues.push({
        code: 'off-grid',
        severity: 'error',
        message: `Panel ${panel.id} sits off the 2 ft grid at (${panel.x}, ${panel.y}).`,
        panelIds: [panel.id],
      });
    }
  }
  if (issues.some((i) => i.severity === 'error')) return emptyResult(issues, false);

  // Each plane is validated on its own. Wall, door and window share the wall
  // line; floor and roof are separate surfaces that legitimately sit above and
  // below the same ground. Feeding them all to one index would report a floor
  // and a roof over the same room as an overlap.
  const linear = panels.filter((panel) => isLinearCategory(panel.category));
  const index = buildEdgeIndex(linear);

  // 2. Overlaps: two panels claiming the same 2 ft edge.
  const overlapPanels = new Set<string>();
  for (const claimants of index.byEdge.values()) {
    if (claimants.length > 1) for (const id of claimants) overlapPanels.add(id);
  }
  if (overlapPanels.size > 0) {
    issues.push({
      code: 'overlap',
      severity: 'error',
      message: `${overlapPanels.size} panels overlap. Each 2 ft of wall must be covered by exactly one panel.`,
      panelIds: [...overlapPanels],
    });
  }

  // 3. Out of bounds: a wall segment that leaves the plot.
  const outsidePanels = new Set<string>();
  for (const panel of linear) {
    for (const edge of panelEdges(panel)) {
      const a = { x: edge.x, y: edge.y };
      const b = edge.axis === 'h' ? { x: edge.x + 1, y: edge.y } : { x: edge.x, y: edge.y + 1 };
      if (!containsSegment(plot, a, b)) {
        outsidePanels.add(panel.id);
        break;
      }
    }
  }
  if (outsidePanels.size > 0) {
    issues.push({
      code: 'outside-plot',
      severity: 'error',
      message: `${outsidePanels.size} panels fall outside the plot boundary.`,
      panelIds: [...outsidePanels],
    });
  }

  // 4. Gaps: an open wall end is a node with exactly one occupied edge. Every
  //    wall must run into another wall, so degree 1 anywhere means a hole.
  const nodes = buildNodeIndex(linear, index);
  for (const info of nodes.values()) {
    if (info.degree === 1) {
      issues.push({
        code: 'open-end',
        severity: 'error',
        message: `Open wall end at (${unitsToFt(info.point.x)} ft, ${unitsToFt(
          info.point.y,
        )} ft). Close the run or remove the stub.`,
        panelIds: [...info.panelIds],
        at: info.point,
      });
    }
  }

  // 5. Detached structures. Legal - an outbuilding is a real design - but worth
  //    surfacing, since it is usually an accident.
  const components = countComponents(index);
  if (components > 1) {
    issues.push({
      code: 'disconnected',
      severity: 'warning',
      message: `Plan contains ${components} separate wall structures. Confirm this is intentional.`,
      panelIds: [],
    });
  }

  // 6. Area categories, each on its own plane.
  for (const category of AREA_CATEGORIES) {
    issues.push(...validateArea(panels, plot, category));
  }

  const hasErrors = issues.some((i) => i.severity === 'error');
  return emptyResult(issues, !hasErrors);
}

/**
 * Floor and roof checks. These run per category, because a floor and a roof
 * over the same room share every cell and that is correct, not a collision.
 */
function validateArea(panels: Panel[], plot: Plot, category: PanelCategory): ValidationIssue[] {
  const area = panels.filter((panel) => panel.category === category);
  if (area.length === 0) return [];

  const issues: ValidationIssue[] = [];

  const claimants = new Map<string, string[]>();
  const outside = new Set<string>();
  for (const panel of area) {
    for (const cell of panelCells(panel)) {
      const key = cellKey(cell);
      const existing = claimants.get(key);
      if (existing) existing.push(panel.id);
      else claimants.set(key, [panel.id]);

      // A cell is in the plot when all four of its corners are.
      const inPlot =
        containsPoint(plot, { x: cell.x, y: cell.y }) &&
        containsPoint(plot, { x: cell.x + 1, y: cell.y }) &&
        containsPoint(plot, { x: cell.x, y: cell.y + 1 }) &&
        containsPoint(plot, { x: cell.x + 1, y: cell.y + 1 });
      if (!inPlot) outside.add(panel.id);
    }
  }

  const overlapping = new Set<string>();
  for (const ids of claimants.values()) {
    if (ids.length > 1) for (const id of ids) overlapping.add(id);
  }
  if (overlapping.size > 0) {
    issues.push({
      code: 'area-overlap',
      severity: 'error',
      message: `${overlapping.size} ${category} panels overlap. Each 2 ft square must be covered by exactly one.`,
      panelIds: [...overlapping],
    });
  }

  if (outside.size > 0) {
    issues.push({
      code: 'area-outside-plot',
      severity: 'error',
      message: `${outside.size} ${category} panels fall outside the plot boundary.`,
      panelIds: [...outside],
    });
  }

  // Partial cover is a warning, not an error: a deck or a partial mezzanine is
  // a real design, and the architect may not want the whole footprint filled.
  const footprint = interiorCells(panels);
  const missing = footprint.cells.filter((cell) => !claimants.has(cellKey(cell)));
  if (missing.length > 0) {
    issues.push({
      code: 'area-incomplete',
      severity: 'warning',
      message: `${missing.length * 4} sq ft of the building has no ${category}. A 10 ft panel cannot reach a strip shallower than 10 ft.`,
      panelIds: [],
    });
  }

  return issues;
}

/** Convenience for the canvas: does this placement collide with what's there? */
export function wouldOverlap(panels: Panel[], candidate: Panel): boolean {
  const occupied = new Set<string>();
  for (const panel of panels) {
    if (panel.id === candidate.id) continue;
    for (const edge of panelEdges(panel)) occupied.add(`${edge.x},${edge.y},${edge.axis}`);
  }
  return panelEdges(candidate).some((e) => occupied.has(`${e.x},${e.y},${e.axis}`));
}

/** Convenience for the canvas: is this placement fully inside the plot? */
export function isInsidePlot(plot: Plot, candidate: Panel): boolean {
  const end = panelEndNode(candidate);
  return containsSegment(plot, { x: candidate.x, y: candidate.y }, end);
}
