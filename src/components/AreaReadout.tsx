import { formatArea } from '../core/units';
import type { LengthUnit } from '../core/units';

export interface PlanAreas {
  /** The parcel being built on. */
  plotSqFt: number;
  /** What the walls actually enclose. Zero until they close a shape. */
  floorSqFt: number;
}

/**
 * Plot and floor area, shown identically over the plan and over the 3D view.
 *
 * One component rather than two so the two views cannot drift apart - the
 * reason the 3D view spent three phases ignoring hidden layers was a rule
 * written once per view instead of once.
 *
 * Floor area reads as a dash rather than 0 until the walls close a shape: an
 * open run encloses nothing, and "0 sq ft" reads as a measurement rather than
 * as "nothing to measure yet".
 */
export function AreaReadout({ areas, unit }: { areas: PlanAreas; unit: LengthUnit }) {
  return (
    <span className="pointer-events-auto rounded bg-white/90 px-2 py-1 text-slate-600 ring-1 ring-slate-200">
      <span className="text-slate-400">Plot</span>{' '}
      <span className="font-mono tabular-nums">{formatArea(areas.plotSqFt, unit)}</span>
      <span className="px-1.5 text-slate-300">·</span>
      <span className="text-slate-400">Floor</span>{' '}
      <span className="font-mono tabular-nums">
        {areas.floorSqFt > 0 ? formatArea(areas.floorSqFt, unit) : '—'}
      </span>
    </span>
  );
}
