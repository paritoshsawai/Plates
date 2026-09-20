/**
 * The validation engine. A plan is manufacturable only when every wall is
 * covered edge to edge with no gaps, no overlaps, and nothing outside the plot.
 *
 * Because panels live on an integer 2 ft grid, all of that is integer
 * bookkeeping over the wall graph - no floating-point tolerances, no
 * near-miss geometry.
 */

import { isKnownCategory, isKnownPanelSize, panelEdges, panelEndNode } from './panels';
import { containsSegment } from './plot';
import { unitsToFt } from './units';
import { buildEdgeIndex, buildNodeIndex, countComponents } from './walls';
import type { Panel, Plot, ValidationIssue, ValidationResult } from './types';

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

  const index = buildEdgeIndex(panels);

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
  for (const panel of panels) {
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
  const nodes = buildNodeIndex(panels, index);
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

  const hasErrors = issues.some((i) => i.severity === 'error');
  return emptyResult(issues, !hasErrors);
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
