import { useState } from 'react';
import { plotAreaSqFt, plotEdgeLengthsFt, rectPlotFromFt } from '../core/plot';
import { GRID_FT, formatFt, isModularFt, nearestModularFt } from '../core/units';
import { useStore } from '../state/store';
import { Button, Field, Modal, NumberInput } from './ui';

interface Props {
  onClose(): void;
}

/**
 * Plot setup. The parcel is entered in real feet and snapped down onto the 2 ft
 * module - the dialog shows exactly what that costs, rather than silently
 * changing the number the surveyor gave.
 */
export function PlotDialog({ onClose }: Props) {
  const plot = useStore((s) => s.plan.plot);
  const setPlot = useStore((s) => s.setPlot);

  const currentEdges = plotEdgeLengthsFt(plot);
  const [widthFt, setWidthFt] = useState(currentEdges[0] ?? 60);
  const [lengthFt, setLengthFt] = useState(currentEdges[1] ?? 40);

  const preview = rectPlotFromFt(widthFt, lengthFt);
  const [buildableWidth, buildableLength] = plotEdgeLengthsFt(preview);
  const lostWidth = widthFt - buildableWidth;
  const lostLength = lengthFt - buildableLength;
  const nonModular = !isModularFt(widthFt) || !isModularFt(lengthFt);

  return (
    <Modal
      title="Plot boundary"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => {
              setPlot(preview);
              onClose();
            }}
          >
            Apply boundary
          </Button>
        </>
      }
    >
      <p className="text-xs leading-relaxed text-slate-600">
        Enter the parcel in feet. Buildable dimensions round <strong>down</strong> onto the{' '}
        {GRID_FT} ft module, so the design area never exceeds the land you actually have.
      </p>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Width (frontage)">
          <NumberInput value={widthFt} onChange={setWidthFt} min={2} step={1} suffix="ft" />
        </Field>
        <Field label="Length (depth)">
          <NumberInput value={lengthFt} onChange={setLengthFt} min={2} step={1} suffix="ft" />
        </Field>
      </div>

      <dl className="space-y-1 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
        <div className="flex justify-between">
          <dt className="text-slate-500">Buildable area</dt>
          <dd className="font-medium tabular-nums text-slate-800">
            {formatFt(buildableWidth)} &times; {formatFt(buildableLength)} ={' '}
            {plotAreaSqFt(preview).toLocaleString('en-IN')} sq ft
          </dd>
        </div>
        {(lostWidth > 0 || lostLength > 0) && (
          <div className="flex justify-between">
            <dt className="text-slate-500">Set aside by snapping</dt>
            <dd className="font-medium tabular-nums text-slate-800">
              {formatFt(lostWidth)} &times; {formatFt(lostLength)}
            </dd>
          </div>
        )}
      </dl>

      {nonModular && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
          A dimension that is not a multiple of {GRID_FT} ft cannot be tiled without cutting a
          panel, which Arplace&rsquo;s system does not allow.
          {!isModularFt(widthFt) && (
            <>
              {' '}
              Nearest buildable widths: {formatFt(nearestModularFt(widthFt).down)} or{' '}
              {formatFt(nearestModularFt(widthFt).up)}.
            </>
          )}
          {!isModularFt(lengthFt) && (
            <>
              {' '}
              Nearest buildable lengths: {formatFt(nearestModularFt(lengthFt).down)} or{' '}
              {formatFt(nearestModularFt(lengthFt).up)}.
            </>
          )}
        </p>
      )}

      <p className="text-xs text-slate-500">
        Changing the boundary does not move existing panels. Any that now fall outside are flagged
        in the status pane.
      </p>
    </Modal>
  );
}
