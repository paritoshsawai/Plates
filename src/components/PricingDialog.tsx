import { useState } from 'react';
import { CATEGORY_STYLE, CONNECTOR_STYLE, PANEL_CATALOG } from '../core/panels';
import { priceOf, setPrice } from '../core/pricing';
import { useStore } from '../state/store';
import type { ConnectorType, PanelCategory, PriceCategory, PriceConfig } from '../core/types';
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

  const setRowPrice = (category: PriceCategory, size: string, unitPrice: number) =>
    setDraft((d) => ({ ...d, rows: setPrice(d, category, size, unitPrice) }));

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
      <p className="text-xs leading-relaxed text-slate-600">
        Every category is priced separately even where the footprint matches. A roof panel and a
        wall panel are both 4 ft &times; 10 ft but are different assemblies, so each row is edited
        on its own.
      </p>

      {(Object.keys(CATEGORY_STYLE) as PanelCategory[]).map((category) => (
        <section key={category}>
          <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: CATEGORY_STYLE[category].color }}
            />
            {CATEGORY_STYLE[category].plural} (ex works, INR)
          </h3>
          <div className="grid grid-cols-2 gap-3">
            {PANEL_CATALOG.map((spec) => (
              <Field key={spec.id} label={spec.label}>
                <NumberInput
                  value={priceOf(draft, category, spec.id)}
                  step={1}
                  onChange={(value) => setRowPrice(category, spec.id, value)}
                  suffix="each"
                />
              </Field>
            ))}
          </div>
        </section>
      ))}

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Junction connectors (ex works, INR)
        </h3>
        <div className="grid grid-cols-2 gap-3">
          {(Object.keys(CONNECTOR_STYLE) as ConnectorType[]).map((type) => (
            <Field key={type} label={CONNECTOR_STYLE[type].label}>
              <NumberInput
                value={priceOf(draft, 'connector', type)}
                step={1}
                onChange={(value) => setRowPrice('connector', type, value)}
                suffix="each"
              />
            </Field>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Connectors are counted from the layout, never placed by hand. Seeded at one flat price;
          differentiate per junction type here whenever Arplace needs to.
        </p>
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
