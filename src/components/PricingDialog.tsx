import { useState } from 'react';
import { PANEL_CATALOG } from '../core/panels';
import { useStore } from '../state/store';
import type { PriceConfig } from '../core/types';
import { Button, Field, Modal, NumberInput } from './ui';

interface Props {
  onClose(): void;
}

/**
 * The admin price schedule. Nothing in the costing maths carries a hard-coded
 * number; every figure a quote shows comes from here, dated, so an old quote
 * can always be traced to the schedule that produced it.
 */
export function PricingDialog({ onClose }: Props) {
  const priceConfig = useStore((s) => s.priceConfig);
  const updatePriceConfig = useStore((s) => s.updatePriceConfig);
  const [draft, setDraft] = useState<PriceConfig>(priceConfig);

  const patch = (fields: Partial<PriceConfig>) => setDraft((d) => ({ ...d, ...fields }));

  return (
    <Modal
      title="Price schedule"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => {
              updatePriceConfig(draft);
              onClose();
            }}
          >
            Save schedule
          </Button>
        </>
      }
    >
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Panel prices (ex works, INR)
        </h3>
        <div className="grid grid-cols-2 gap-3">
          {PANEL_CATALOG.map((spec) => (
            <Field key={spec.id} label={spec.label}>
              <NumberInput
                value={draft.panelUnitPrice[spec.id]}
                step={1}
                onChange={(value) =>
                  patch({ panelUnitPrice: { ...draft.panelUnitPrice, [spec.id]: value } })
                }
                suffix="each"
              />
            </Field>
          ))}
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Cost factors
        </h3>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Labor">
            <NumberInput
              value={draft.laborPerPanel}
              onChange={(laborPerPanel) => patch({ laborPerPanel })}
              suffix="per panel"
            />
          </Field>
          <Field label="Transport">
            <NumberInput
              value={draft.transportPerPanel}
              onChange={(transportPerPanel) => patch({ transportPerPanel })}
              suffix="per panel"
            />
          </Field>
          <Field label="Transport (flat)">
            <NumberInput
              value={draft.transportFlat}
              onChange={(transportFlat) => patch({ transportFlat })}
              suffix="per order"
            />
          </Field>
          <Field label="Tax">
            <NumberInput
              value={draft.taxPercent}
              onChange={(taxPercent) => patch({ taxPercent })}
              step={0.5}
              suffix="%"
            />
          </Field>
        </div>
      </section>

      <section className="space-y-3">
        <Field label="Effective from" hint="Stamped onto every quote generated with this schedule.">
          <input
            type="date"
            value={draft.effectiveDate}
            onChange={(e) => patch({ effectiveDate: e.target.value })}
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
          />
        </Field>
        <Field label="Note" hint="Provenance, e.g. the approval this schedule came from.">
          <input
            type="text"
            value={draft.note}
            onChange={(e) => patch({ note: e.target.value })}
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
          />
        </Field>
      </section>
    </Modal>
  );
}
