import { useState } from 'react';
import { plotAreaSqFt, plotEdgeLengthsFt, rectPlotFromFt } from '../core/plot';
import {
  formatArea,
  formatLength,
  fromDisplay,
  inputMin,
  inputStep,
  isModularFt,
  moduleLabel,
  nearestModularFt,
  toInputValue,
} from '../core/units';
import { useStore } from '../state/store';
import { Button, Field, Modal, NumberInput } from './ui';

interface Props {
  onClose(): void;
}

/**
 * Plot setup. The parcel is entered in the reader's own unit and snapped down
 * onto the 2 ft module - the dialog shows exactly what that costs, rather than
 * silently changing the number the surveyor gave.
 *
 * The two inputs hold *display* values, not feet, and convert once on the way
 * into the model. Holding feet and converting on the way out would re-round
 * every keystroke, so a typed 18.5 m would redisplay as 18.500000000000004.
 */
export function PlotDialog({ onClose }: Props) {
  const plot = useStore((s) => s.plan.plot);
  const setPlot = useStore((s) => s.setPlot);

  const unit = useStore((s) => s.unit);

  const currentEdges = plotEdgeLengthsFt(plot);
  const [width, setWidth] = useState(() => toInputValue(currentEdges[0] ?? 60, unit));
  const [length, setLength] = useState(() => toInputValue(currentEdges[1] ?? 40, unit));

  const widthFt = fromDisplay(width, unit);
  const lengthFt = fromDisplay(length, unit);
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
        Enter the parcel in {unit === 'm' ? 'metres' : 'feet'}. Buildable dimensions round{' '}
        <strong>down</strong> onto the {moduleLabel(unit)} module, so the design area never exceeds
        the land you actually have.
      </p>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Width (frontage)">
          <NumberInput
            value={width}
            onChange={setWidth}
            min={inputMin(unit)}
            step={inputStep(unit)}
            suffix={unit}
          />
        </Field>
        <Field label="Length (depth)">
          <NumberInput
            value={length}
            onChange={setLength}
            min={inputMin(unit)}
            step={inputStep(unit)}
            suffix={unit}
          />
        </Field>
      </div>

      <dl className="space-y-1 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
        <div className="flex justify-between">
          <dt className="text-slate-500">Buildable area</dt>
          <dd className="font-medium tabular-nums text-slate-800">
            {formatLength(buildableWidth, unit)} &times; {formatLength(buildableLength, unit)} ={' '}
            {formatArea(plotAreaSqFt(preview), unit)}
          </dd>
        </div>
        {(lostWidth > 0 || lostLength > 0) && (
          <div className="flex justify-between">
            <dt className="text-slate-500">Set aside by snapping</dt>
            <dd className="font-medium tabular-nums text-slate-800">
              {formatLength(lostWidth, unit)} &times; {formatLength(lostLength, unit)}
            </dd>
          </div>
        )}
      </dl>

      {nonModular && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
          A dimension that is not a multiple of {moduleLabel(unit)} cannot be tiled without cutting
          a panel, which Arplace&rsquo;s system does not allow.
          {!isModularFt(widthFt) && (
            <>
              {' '}
              Nearest buildable widths: {formatLength(nearestModularFt(widthFt).down, unit)} or{' '}
              {formatLength(nearestModularFt(widthFt).up, unit)}.
            </>
          )}
          {!isModularFt(lengthFt) && (
            <>
              {' '}
              Nearest buildable lengths: {formatLength(nearestModularFt(lengthFt).down, unit)} or{' '}
              {formatLength(nearestModularFt(lengthFt).up, unit)}.
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
