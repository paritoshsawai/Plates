import { CATEGORY_STYLE } from '../core/panels';
import { formatCurrency, isPlaceholderPricing } from '../core/pricing';
import { formatFt } from '../core/units';
import type { Bom, BomGroup, ValidationResult } from '../core/types';
import { useStore } from '../state/store';
import { SectionTitle } from './ui';

interface Props {
  bom: Bom;
  validation: ValidationResult;
  onEditPricing(): void;
}

export function RightRail({ bom, validation, onEditPricing }: Props) {
  const priceConfig = useStore((s) => s.priceConfig);
  const role = useStore((s) => s.role);
  const select = useStore((s) => s.select);
  const setTool = useStore((s) => s.setTool);

  return (
    <aside className="flex w-full shrink-0 flex-col gap-5 border-t border-slate-200 bg-white p-4 lg:w-80 lg:overflow-y-auto lg:border-t-0 lg:border-l">
      <section>
        <SectionTitle>Status</SectionTitle>
        <StatusBadge validation={validation} />
        {validation.issues.length > 0 && (
          <ul className="mt-2 space-y-1.5">
            {validation.issues.slice(0, 8).map((issue, i) => (
              <li key={`${issue.code}-${i}`}>
                <button
                  type="button"
                  onClick={() => {
                    if (issue.panelIds.length === 0) return;
                    setTool('select');
                    select(issue.panelIds);
                  }}
                  disabled={issue.panelIds.length === 0}
                  className={`w-full rounded-md border px-2.5 py-2 text-left text-xs leading-snug transition ${
                    issue.severity === 'error'
                      ? 'border-red-200 bg-red-50 text-red-800 hover:bg-red-100'
                      : 'border-amber-200 bg-amber-50 text-amber-800'
                  } disabled:cursor-default disabled:hover:bg-inherit`}
                >
                  {issue.message}
                </button>
              </li>
            ))}
            {validation.issues.length > 8 && (
              <li className="px-1 text-xs text-slate-500">
                and {validation.issues.length - 8} more&hellip;
              </li>
            )}
          </ul>
        )}
      </section>

      <section>
        <SectionTitle>Bill of materials</SectionTitle>
        <div className="space-y-4">
          {bom.groups.map((group) => (
            <BomGroupTable key={group.category} group={group} />
          ))}
        </div>
        <div className="mt-3 flex justify-between border-t-2 border-slate-300 pt-1.5 text-xs">
          <span className="font-semibold text-slate-800">
            {bom.totalPanels} panels
            {bom.totalConnectors > 0 && ` \u00b7 ${bom.totalConnectors} connectors`}
          </span>
          <span className="font-semibold tabular-nums text-slate-900">
            {formatCurrency(bom.cost.panels + bom.cost.connectors)}
          </span>
        </div>
      </section>

      <section>
        <SectionTitle>Estimate</SectionTitle>
        <dl className="space-y-1 text-xs">
          <CostRow label="Panels" value={bom.cost.panels} />
          {bom.cost.connectors > 0 && <CostRow label="Connectors" value={bom.cost.connectors} />}
          {bom.cost.labor > 0 && <CostRow label="Labor" value={bom.cost.labor} />}
          {bom.cost.transport > 0 && <CostRow label="Transport" value={bom.cost.transport} />}
          {bom.cost.tax > 0 && (
            <CostRow label={`Tax (${priceConfig.taxPercent}%)`} value={bom.cost.tax} />
          )}
          <div className="flex justify-between border-t border-slate-200 pt-1.5">
            <dt className="text-sm font-semibold text-slate-800">Total</dt>
            <dd className="text-sm font-semibold tabular-nums text-slate-900">
              {formatCurrency(bom.cost.total)}
            </dd>
          </div>
        </dl>
        <p className="mt-2 text-xs text-slate-500">
          Price schedule effective {bom.priceEffectiveDate}.
        </p>
        {isPlaceholderPricing(priceConfig) && (
          <p className="mt-1.5 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
            These are the seeded placeholder prices. An admin must enter Arplace&rsquo;s real
            schedule before quoting.
          </p>
        )}
        {role === 'admin' && (
          <button
            type="button"
            onClick={onEditPricing}
            className="mt-2 text-xs font-medium text-blue-600 hover:underline"
          >
            Edit price schedule
          </button>
        )}
      </section>

      <section>
        <SectionTitle>Material utilisation</SectionTitle>
        <dl className="space-y-1 text-xs text-slate-600">
          <PlainRow label="Wall length" value={formatFt(bom.utilization.linearFt)} />
          <PlainRow label="Offcut produced" value={`${bom.utilization.offcutFt} ft`} />
          <PlainRow
            label="Offcut avoided"
            value={formatFt(bom.utilization.offcutAvoidedFt)}
          />
          <PlainRow
            label="Panel optimality"
            value={`${Math.round(bom.utilization.optimalityPercent)}%`}
          />
        </dl>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200">
          <div
            className="h-full rounded-full bg-teal-500 transition-all"
            style={{ width: `${Math.round(bom.utilization.optimalityPercent)}%` }}
          />
        </div>
        <p className="mt-2 text-xs leading-snug text-slate-500">
          Panels are laid whole, so this layout produces no offcut. &ldquo;Offcut avoided&rdquo;
          is what a cut-to-fit build would have wasted on the same walls. Optimality compares the{' '}
          {bom.utilization.panelCount} panels placed against the {bom.utilization.optimalPanelCount}{' '}
          that would cover this geometry.
        </p>
      </section>
    </aside>
  );
}

/**
 * One category's lines with its own subtotal. A wall panel and a roof panel of
 * identical dimensions are different SKUs, so the quote never merges them into
 * a single undifferentiated list.
 */
function BomGroupTable({ group }: { group: BomGroup }) {
  const swatch =
    group.category === 'connector'
      ? '#64748b'
      : CATEGORY_STYLE[group.category].color;

  return (
    <div>
      <h4 className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-slate-700">
        <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: swatch }} />
        {group.label}
      </h4>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-slate-200 text-slate-500">
            <th className="py-1 text-left font-medium">SKU</th>
            <th className="py-1 text-right font-medium">Qty</th>
            <th className="py-1 text-right font-medium">Unit</th>
            <th className="py-1 text-right font-medium">Total</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {group.lines.map((line) => (
            <tr key={line.sku} className="border-b border-slate-100">
              <td className="py-1.5 text-slate-700">{line.sku}</td>
              <td className="py-1.5 text-right font-semibold text-slate-800">{line.qty}</td>
              <td className="py-1.5 text-right text-slate-500">{formatCurrency(line.unitPrice)}</td>
              <td className="py-1.5 text-right text-slate-700">{formatCurrency(line.lineTotal)}</td>
            </tr>
          ))}
          <tr>
            <td className="py-1.5 text-slate-500">Subtotal</td>
            <td className="py-1.5 text-right font-semibold text-slate-900">{group.qty}</td>
            <td />
            <td className="py-1.5 text-right font-semibold text-slate-900">
              {formatCurrency(group.subtotal)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function StatusBadge({ validation }: { validation: ValidationResult }) {
  if (validation.manufacturable) {
    return (
      <p className="rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-2 text-sm font-semibold text-emerald-800">
        Manufacturable &#10003;
      </p>
    );
  }
  const blocking = validation.errors.length;
  return (
    <p className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2 text-sm font-semibold text-slate-700">
      {blocking > 0
        ? `${blocking} issue${blocking === 1 ? '' : 's'} to resolve`
        : 'Nothing built yet'}
    </p>
  );
}

function CostRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between">
      <dt className="text-slate-500">{label}</dt>
      <dd className="tabular-nums text-slate-700">{formatCurrency(value)}</dd>
    </div>
  );
}

function PlainRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-medium tabular-nums text-slate-700">{value}</dd>
    </div>
  );
}
