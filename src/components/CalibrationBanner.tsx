import { useState } from 'react';
import { GRID_FT, formatLength, fromDisplay, inputStep } from '../core/units';
import { useStore } from '../state/store';
import { Button, NumberInput } from './ui';

/**
 * The scale-setting prompt, shown over the canvas while calibrating.
 *
 * A banner rather than a modal: the architect has to see and click the drawing
 * while this is up, so it cannot take the screen.
 */
export function CalibrationBanner() {
  const calibration = useStore((s) => s.calibration);
  const cancelCalibration = useStore((s) => s.cancelCalibration);
  const applyCalibration = useStore((s) => s.applyCalibration);
  const unit = useStore((s) => s.unit);
  // Held in the reader's own unit and converted once on Apply, so typing is
  // never fighting a round-trip through feet.
  const [realLength, setRealLength] = useState(() => (unit === 'm' ? 6 : 20));

  if (!calibration.active) return null;

  const { from, to } = calibration;
  const spanUnits = from && to ? Math.hypot(to.x - from.x, to.y - from.y) : 0;
  const ready = spanUnits > 0;

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-center p-3">
      <div className="pointer-events-auto w-full max-w-md rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
        <p className="text-sm font-semibold text-slate-800">
          {!from
            ? 'Click one end of a known dimension'
            : !to
              ? 'Now click the other end'
              : 'How long is that really?'}
        </p>

        {ready ? (
          <>
            <p className="mt-1 text-xs text-slate-500">
              That span currently reads {formatLength(spanUnits * GRID_FT, unit)}. Type its real
              length and the scan is rescaled to match.
            </p>
            <div className="mt-2 flex items-end gap-2">
              <div className="flex-1">
                <NumberInput
                  value={realLength}
                  onChange={setRealLength}
                  min={inputStep(unit)}
                  step={inputStep(unit)}
                  suffix={unit}
                />
              </div>
              <Button
                variant="primary"
                onClick={() => applyCalibration(fromDisplay(realLength, unit))}
              >
                Apply
              </Button>
              <Button onClick={cancelCalibration}>Cancel</Button>
            </div>
          </>
        ) : (
          <div className="mt-2 flex items-center justify-between gap-3">
            <p className="text-xs text-slate-500">
              Pick something you have a real measurement for &mdash; a dimensioned wall or a scale
              bar.
            </p>
            <Button onClick={cancelCalibration}>Cancel</Button>
          </div>
        )}
      </div>
    </div>
  );
}
