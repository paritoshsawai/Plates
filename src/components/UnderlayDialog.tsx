import { useRef, useState } from 'react';
import { plotBboxUnits } from '../core/plot';
import { GRID_FT, formatFt } from '../core/units';
import { loadUnderlayFile } from '../canvas/underlay';
import { useStore } from '../state/store';
import { Button, Field, Modal, NumberInput } from './ui';

interface Props {
  onClose(): void;
}

/**
 * Trace-over setup.
 *
 * A scan has no inherent scale, so the flow is deliberately upload-then-
 * calibrate: an uncalibrated underlay would produce a building of the wrong
 * size with nothing to warn you.
 */
export function UnderlayDialog({ onClose }: Props) {
  const plan = useStore((s) => s.plan);
  const setUnderlay = useStore((s) => s.setUnderlay);
  const updateUnderlay = useStore((s) => s.updateUnderlay);
  const startCalibration = useStore((s) => s.startCalibration);
  const notify = useStore((s) => s.notify);

  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const underlay = plan.underlay;

  const handleFile = async (file: File) => {
    setBusy(true);
    try {
      const loaded = await loadUnderlayFile(file);
      // Start roughly plot-width so the image is visible straight away; the
      // real size comes from calibration.
      const box = plotBboxUnits(plan.plot);
      const plotWidthUnits = Math.max(1, box.maxX - box.minX);
      setUnderlay({
        dataUrl: loaded.dataUrl,
        x: box.minX,
        y: box.minY,
        scale: plotWidthUnits / loaded.widthPx,
        opacity: 0.5,
        name: loaded.name,
      });
      notify('Underlay added. Calibrate it against a known dimension next.');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'That image could not be loaded.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Trace over a plan"
      onClose={onClose}
      footer={<Button onClick={onClose}>Close</Button>}
    >
      <p className="text-xs leading-relaxed text-slate-600">
        Drop in a scanned plan or survey and draw over it. The image is a reference only &mdash; it
        never becomes panels, and everything you trace still snaps to the {GRID_FT} ft module.
      </p>

      {!underlay && (
        <Button variant="primary" onClick={() => fileInput.current?.click()} disabled={busy}>
          {busy ? 'Loading…' : 'Choose a PNG or JPG'}
        </Button>
      )}

      {underlay && (
        <>
          <dl className="space-y-1 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">File</dt>
              <dd className="truncate font-medium text-slate-800">{underlay.name}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Scale</dt>
              <dd className="font-medium tabular-nums text-slate-800">
                {formatFt(Math.round(underlay.scale * GRID_FT * 1000) / 1000)} per image pixel
              </dd>
            </div>
          </dl>

          <Field
            label="Opacity"
            hint="Fade the scan back until your own lines read more strongly than it does."
          >
            <input
              type="range"
              min={5}
              max={100}
              value={Math.round(underlay.opacity * 100)}
              onChange={(e) => updateUnderlay({ opacity: Number(e.target.value) / 100 })}
              className="w-full"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Move left / right">
              <NumberInput
                value={Math.round(underlay.x * GRID_FT * 10) / 10}
                step={2}
                min={-10000}
                onChange={(ft) => updateUnderlay({ x: ft / GRID_FT })}
                suffix="ft"
              />
            </Field>
            <Field label="Move up / down">
              <NumberInput
                value={Math.round(underlay.y * GRID_FT * 10) / 10}
                step={2}
                min={-10000}
                onChange={(ft) => updateUnderlay({ y: ft / GRID_FT })}
                suffix="ft"
              />
            </Field>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              onClick={() => {
                startCalibration();
                onClose();
              }}
            >
              Set the scale
            </Button>
            <Button onClick={() => fileInput.current?.click()} disabled={busy}>
              Replace image
            </Button>
            <Button variant="danger" onClick={() => setUnderlay(null)}>
              Remove
            </Button>
          </div>

          <p className="text-xs leading-relaxed text-slate-500">
            <strong>Set the scale</strong> asks you to click the two ends of something whose real
            length you know &mdash; a measured wall, a dimension line, a scale bar &mdash; and type
            that length. Everything else follows from it.
          </p>
        </>
      )}

      <p className="text-xs leading-relaxed text-slate-500">
        Images are resized before they are stored, so a traced plan stays about the same size as an
        untraced one. PDFs are not read yet; export the page to PNG first.
      </p>

      <input
        ref={fileInput}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void handleFile(file);
        }}
      />
    </Modal>
  );
}
