import { useRef, useState } from 'react';
import { useCompactLayout } from './useMediaQuery';
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

export type View = 'plan' | '3d';

interface Props {
  exports: ExportActions;
  view: View;
  onSetView(view: View): void;
  onOpenPlans(): void;
  onOpenPricing(): void;
  onNewPlan(): void;
}

export function TopBar({
  exports,
  view,
  onSetView,
  onOpenPlans,
  onOpenPricing,
  onNewPlan,
}: Props) {
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
  const [moreOpen, setMoreOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  // Nine controls and a text field wrap to five rows on a phone, which cost
  // 380 px of an 844 px screen. Below lg the file actions fold into a menu.
  const compact = useCompactLayout();

  const readOnly = role === 'client';

  /**
   * The exports, defined once.
   *
   * A desktop shows them in their own dropdown with a hint under each; a
   * narrow bar folds them into the overflow menu, where a dedicated Export
   * button was costing a row it did not earn. Listing them twice would be two
   * places to forget when a sixth export arrives.
   */
  const exportItems: Array<{ label: string; hint: string; run(): void }> = [
    { label: 'Quote PDF', hint: 'Drawing, BOM and estimate', run: () => void exports.pdf() },
    { label: 'Plan PNG', hint: 'The drawing on its own', run: () => exports.png() },
    { label: 'BOM CSV', hint: 'Counts, costs, utilisation', run: () => exports.csv() },
    { label: 'Plan JSON', hint: 'Round-trips back via Import', run: () => exports.planJson() },
    { label: 'Work order JSON', hint: 'The ERP payload', run: () => exports.workOrderJson() },
  ];

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
        className="w-32 min-w-0 flex-1 rounded border border-transparent px-2 py-1 text-sm font-medium text-slate-800 hover:border-slate-200 focus:border-blue-500 focus:outline-none read-only:hover:border-transparent lg:w-52 lg:flex-none"
      />
      <span className="text-xs text-slate-400">
        v{plan.version}
        {dirty && ' · unsaved'}
      </span>

      {/* The view switch lives here rather than on a strip of its own: that
          strip cost a whole row on a phone and the header has the space. */}
      <div className="flex gap-1">
        {(['plan', '3d'] as const).map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => onSetView(id)}
            aria-pressed={view === id}
            className={`rounded px-2.5 py-1.5 text-sm font-medium transition ${
              view === id ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {id === 'plan' ? 'Plan' : '3D'}
          </button>
        ))}
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-1.5">
        {!readOnly && (
          <>
            <Button onClick={undo} disabled={past === 0} title="Ctrl+Z">
              Undo
            </Button>
            <Button onClick={redo} disabled={future === 0} title="Ctrl+Shift+Z">
              Redo
            </Button>
          </>
        )}

        {!compact && (
          <>
            {!readOnly && (
              <>
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
          </>
        )}

        {!compact && (
          <div className="relative">
            <Button onClick={() => setExportOpen((open) => !open)}>Export &#9662;</Button>
            {exportOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setExportOpen(false)} />
                <div className="absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded-md border border-slate-200 bg-white py-1 shadow-lg">
                  {exportItems.map((item) => (
                    <ExportItem
                      key={item.label}
                      label={item.label}
                      hint={item.hint}
                      onClick={() => {
                        item.run();
                        setExportOpen(false);
                      }}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {role === 'admin' && !compact && <Button onClick={onOpenPricing}>Pricing</Button>}

        <UnitSwitch unit={unit} onChange={setUnit} />

        {compact && (
          <div className="relative">
            <Button onClick={() => setMoreOpen((open) => !open)} title="More actions">
              &#8943;
            </Button>
            {moreOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMoreOpen(false)} />
                <div className="absolute right-0 z-20 mt-1 w-52 overflow-hidden rounded-md border border-slate-200 bg-white py-1 shadow-lg">
                  {exportItems.map((item) => (
                    <MenuItem
                      key={item.label}
                      label={item.label}
                      onClick={() => {
                        item.run();
                        setMoreOpen(false);
                      }}
                    />
                  ))}
                  <div className="my-1 border-t border-slate-200" />
                  {!readOnly && (
                    <MenuItem
                      label="Save version"
                      onClick={() => {
                        saveVersion();
                        setMoreOpen(false);
                      }}
                    />
                  )}
                  <MenuItem
                    label="Open…"
                    onClick={() => {
                      onOpenPlans();
                      setMoreOpen(false);
                    }}
                  />
                  {!readOnly && (
                    <>
                      <MenuItem
                        label="Import…"
                        onClick={() => {
                          fileInput.current?.click();
                          setMoreOpen(false);
                        }}
                      />
                      <MenuItem
                        label="New plan"
                        onClick={() => {
                          onNewPlan();
                          setMoreOpen(false);
                        }}
                      />
                    </>
                  )}
                  {role === 'admin' && (
                    <MenuItem
                      label="Pricing…"
                      onClick={() => {
                        onOpenPricing();
                        setMoreOpen(false);
                      }}
                    />
                  )}
                  <div className="my-1 border-t border-slate-200" />
                  <label className="block px-3 py-2 text-xs text-slate-500">
                    View as
                    <select
                      value={role}
                      onChange={(e) => setRole(e.target.value as Role)}
                      aria-label="Role"
                      className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700 focus:border-blue-500 focus:outline-none"
                    >
                      <option value="architect">Architect</option>
                      <option value="admin">Admin</option>
                      <option value="client">Client (read-only)</option>
                    </select>
                  </label>
                </div>
              </>
            )}
          </div>
        )}

        <select
          value={role}
          onChange={(e) => setRole(e.target.value as Role)}
          aria-label="Role"
          hidden={compact}
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

function MenuItem({ label, onClick }: { label: string; onClick(): void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="block min-h-11 w-full px-3 py-2 text-left text-sm text-slate-800 hover:bg-slate-50"
    >
      {label}
    </button>
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
