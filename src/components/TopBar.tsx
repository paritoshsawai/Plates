import { useRef, useState } from 'react';
import { useStore } from '../state/store';
import type { Role } from '../state/store';
import type { LengthUnit } from '../core/units';
import { Button } from './ui';

export interface ExportActions {
  png(): void;
  pdf(): void | Promise<void>;
  csv(): void;
  planJson(): void;
  workOrderJson(): void;
}

interface Props {
  exports: ExportActions;
  onOpenPlans(): void;
  onOpenPricing(): void;
  onNewPlan(): void;
}

export function TopBar({ exports, onOpenPlans, onOpenPricing, onNewPlan }: Props) {
  const plan = useStore((s) => s.plan);
  const dirty = useStore((s) => s.dirty);
  const role = useStore((s) => s.role);
  const setRole = useStore((s) => s.setRole);
  const unit = useStore((s) => s.unit);
  const setUnit = useStore((s) => s.setUnit);
  const setPlanName = useStore((s) => s.setPlanName);
  const saveVersion = useStore((s) => s.saveVersion);
  const importPlan = useStore((s) => s.importPlan);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const past = useStore((s) => s.past.length);
  const future = useStore((s) => s.future.length);

  const [exportOpen, setExportOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const readOnly = role === 'client';

  return (
    <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-200 bg-white px-4 py-2.5">
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-semibold tracking-tight text-slate-900">Panel Studio</span>
        <span className="hidden text-xs text-slate-400 lg:inline">Arplace</span>
      </div>

      <div className="mx-2 h-5 w-px bg-slate-200" />

      <input
        value={plan.name}
        onChange={(e) => setPlanName(e.target.value)}
        readOnly={readOnly}
        aria-label="Plan name"
        className="w-52 rounded border border-transparent px-2 py-1 text-sm font-medium text-slate-800 hover:border-slate-200 focus:border-blue-500 focus:outline-none read-only:hover:border-transparent"
      />
      <span className="text-xs text-slate-400">
        v{plan.version}
        {dirty && ' · unsaved'}
      </span>

      <div className="ml-auto flex flex-wrap items-center gap-1.5">
        {!readOnly && (
          <>
            <Button onClick={undo} disabled={past === 0} title="Ctrl+Z">
              Undo
            </Button>
            <Button onClick={redo} disabled={future === 0} title="Ctrl+Shift+Z">
              Redo
            </Button>
            <div className="mx-1 h-5 w-px bg-slate-200" />
            <Button onClick={onNewPlan}>New</Button>
          </>
        )}
        <Button onClick={onOpenPlans}>Open</Button>
        {!readOnly && (
          <>
            <Button onClick={() => fileInput.current?.click()}>Import</Button>
            <Button variant="primary" onClick={saveVersion}>
              Save version
            </Button>
          </>
        )}

        <div className="relative">
          <Button onClick={() => setExportOpen((open) => !open)}>Export &#9662;</Button>
          {exportOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setExportOpen(false)} />
              <div className="absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded-md border border-slate-200 bg-white py-1 shadow-lg">
                <ExportItem
                  label="Quote PDF"
                  hint="Drawing, BOM and estimate"
                  onClick={() => {
                    exports.pdf();
                    setExportOpen(false);
                  }}
                />
                <ExportItem
                  label="Plan PNG"
                  hint="The drawing on its own"
                  onClick={() => {
                    exports.png();
                    setExportOpen(false);
                  }}
                />
                <ExportItem
                  label="BOM CSV"
                  hint="Counts, costs, utilisation"
                  onClick={() => {
                    exports.csv();
                    setExportOpen(false);
                  }}
                />
                <ExportItem
                  label="Plan JSON"
                  hint="Round-trips back via Import"
                  onClick={() => {
                    exports.planJson();
                    setExportOpen(false);
                  }}
                />
                <ExportItem
                  label="Work order JSON"
                  hint="The ERP payload"
                  onClick={() => {
                    exports.workOrderJson();
                    setExportOpen(false);
                  }}
                />
              </div>
            </>
          )}
        </div>

        {role === 'admin' && <Button onClick={onOpenPricing}>Pricing</Button>}

        <UnitSwitch unit={unit} onChange={setUnit} />

        <select
          value={role}
          onChange={(e) => setRole(e.target.value as Role)}
          aria-label="Role"
          className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700 focus:border-blue-500 focus:outline-none"
        >
          <option value="architect">Architect</option>
          <option value="admin">Admin</option>
          <option value="client">Client (read-only)</option>
        </select>
      </div>

      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          importPlan(await file.text());
        }}
      />
    </header>
  );
}

/**
 * Feet or metres. A view preference, so every role gets it - a client reading
 * a plan in metres is exactly who this is for. It changes what is displayed
 * and typed, never what is built: the panels stay 4 ft and 2 ft.
 */
function UnitSwitch({
  unit,
  onChange,
}: {
  unit: LengthUnit;
  onChange(next: LengthUnit): void;
}) {
  return (
    <div
      role="group"
      aria-label="Units"
      className="flex overflow-hidden rounded-md border border-slate-300"
    >
      {(
        [
          ['ft', 'Feet'],
          ['m', 'Metres'],
        ] as const
      ).map(([value, label]) => (
        <button
          key={value}
          type="button"
          onClick={() => onChange(value)}
          aria-pressed={unit === value}
          title={`Show and enter dimensions in ${label.toLowerCase()}`}
          className={`px-2.5 py-1.5 text-sm transition ${
            unit === value
              ? 'bg-slate-900 text-white'
              : 'bg-white text-slate-600 hover:bg-slate-50'
          }`}
        >
          {value === 'm' ? 'm' : 'ft'}
        </button>
      ))}
    </div>
  );
}

function ExportItem({
  label,
  hint,
  onClick,
}: {
  label: string;
  hint: string;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full px-3 py-2 text-left hover:bg-slate-50"
    >
      <span className="block text-sm text-slate-800">{label}</span>
      <span className="block text-xs text-slate-500">{hint}</span>
    </button>
  );
}
