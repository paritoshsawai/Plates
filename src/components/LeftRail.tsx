import {
  CATEGORY_STYLE,
  OPENING_CATEGORIES,
  PANEL_CATALOG,
  PLACEABLE_CATEGORIES,
} from '../core/panels';
import { GRID_FT, WALL_HEIGHT_FT, formatFt } from '../core/units';
import { plotAreaSqFt, plotEdgeLengthsFt } from '../core/plot';
import { useStore } from '../state/store';
import { Button, SectionTitle } from './ui';

interface Props {
  onEditPlot(): void;
}

export function LeftRail({ onEditPlot }: Props) {
  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);
  const brush = useStore((s) => s.brush);
  const setBrush = useStore((s) => s.setBrush);
  const activeCategory = useStore((s) => s.activeCategory);
  const setActiveCategory = useStore((s) => s.setActiveCategory);
  const plot = useStore((s) => s.plan.plot);
  const role = useStore((s) => s.role);
  const selectionCount = useStore((s) => s.selection.length);
  const rotateSelection = useStore((s) => s.rotateSelection);
  const duplicateSelection = useStore((s) => s.duplicateSelection);
  const deleteSelection = useStore((s) => s.deleteSelection);
  const openingBrush = useStore((s) => s.openingBrush);
  const setOpeningBrush = useStore((s) => s.setOpeningBrush);
  const selection = useStore((s) => s.selection);
  const panels = useStore((s) => s.plan.panels);
  const splitPanel = useStore((s) => s.splitPanel);

  // Splitting only means anything for a 4 ft panel.
  const splittable = selection.filter(
    (id) => panels.find((p) => p.id === id)?.size === '4x10',
  );

  const readOnly = role === 'client';
  const edges = plotEdgeLengthsFt(plot);

  return (
    <aside className="flex w-full shrink-0 flex-col gap-5 border-t border-slate-200 bg-white p-4 lg:w-60 lg:overflow-y-auto lg:border-t-0 lg:border-r">
      <section>
        <SectionTitle>Tools</SectionTitle>
        <div className="grid gap-1.5">
          <ToolButton
            active={tool === 'wall'}
            disabled={readOnly}
            onClick={() => setTool('wall')}
            label="Draw wall"
            hint="Click two points; the run is auto-filled with the fewest panels."
          />
          <ToolButton
            active={tool === 'panel'}
            disabled={readOnly}
            onClick={() => setTool('panel')}
            label="Place panel"
            hint="Drop a single panel on the nearest wall line."
          />
          <ToolButton
            active={tool === 'select'}
            onClick={() => setTool('select')}
            label="Select & pan"
            hint="Drag panels to move, drag the background to pan."
          />
        </div>
      </section>

      <section>
        <SectionTitle>Category</SectionTitle>
        <div className="grid gap-1.5">
          {PLACEABLE_CATEGORIES.map((category) => (
            <button
              key={category}
              type="button"
              disabled={readOnly}
              onClick={() => setActiveCategory(category)}
              className={`flex items-center gap-2.5 rounded-md border px-2.5 py-2 text-left transition disabled:cursor-not-allowed disabled:opacity-40 ${
                activeCategory === category
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-slate-200 hover:bg-slate-50'
              }`}
            >
              <span
                className="h-3 w-3 shrink-0 rounded-sm"
                style={{ backgroundColor: CATEGORY_STYLE[category].color }}
              />
              <span className="text-sm text-slate-700">{CATEGORY_STYLE[category].plural}</span>
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Colour marks the category; length marks the size. Floor and roof panels arrive with the
          area-tiling layer.
        </p>
      </section>

      <section>
        <SectionTitle>Size</SectionTitle>
        <div className="grid gap-1.5">
          {PANEL_CATALOG.map((spec) => (
            <button
              key={spec.id}
              type="button"
              disabled={readOnly}
              onClick={() => {
                setBrush(spec.id);
                setTool('panel');
              }}
              className={`flex items-center gap-2.5 rounded-md border px-2.5 py-2 text-left transition disabled:cursor-not-allowed disabled:opacity-40 ${
                brush === spec.id && tool === 'panel'
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-slate-200 hover:bg-slate-50'
              }`}
            >
              <span
                className="h-3 shrink-0 rounded-sm"
                style={{
                  backgroundColor: CATEGORY_STYLE[activeCategory].color,
                  width: spec.widthFt * 6,
                }}
              />
              <span className="text-sm text-slate-700">{spec.label}</span>
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Panels are never cut or resized. Everything snaps to the {GRID_FT} ft module, the greatest
          common divisor of the two widths.
        </p>
      </section>

      {!readOnly && (
        <section>
          <SectionTitle>Openings</SectionTitle>
          <div className="grid gap-1.5">
            {OPENING_CATEGORIES.map((category) => (
              <button
                key={category}
                type="button"
                onClick={() => setOpeningBrush(openingBrush === category ? null : category)}
                className={`flex items-center gap-2.5 rounded-md border px-2.5 py-2 text-left transition ${
                  openingBrush === category
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <span
                  className="h-3 w-3 shrink-0 rounded-sm border-2"
                  style={{ borderColor: CATEGORY_STYLE[category].color }}
                />
                <span className="text-sm text-slate-700">{CATEGORY_STYLE[category].label}</span>
              </button>
            ))}
            {openingBrush && (
              <Button variant="ghost" onClick={() => setOpeningBrush(null)}>
                Done
              </Button>
            )}
          </div>
          <p className="mt-2 text-xs leading-snug text-slate-500">
            {openingBrush
              ? `Click a panel to turn it into a ${CATEGORY_STYLE[openingBrush].label.toLowerCase()}. Click it again with the same tool to change it back.`
              : 'Openings are pre-cut at the factory, so one replaces a whole panel. Pick a type, then click the panel it goes in.'}
          </p>
          {splittable.length > 0 && (
            <div className="mt-2">
              <Button onClick={() => splittable.forEach(splitPanel)}>
                Split into 2 ft panels
              </Button>
              <p className="mt-1 text-xs leading-snug text-slate-500">
                A 2 ft opening needs a 2 ft panel to sit in.
              </p>
            </div>
          )}
        </section>
      )}

      {!readOnly && (
        <section>
          <SectionTitle>Selection</SectionTitle>
          <div className="flex flex-wrap gap-1.5">
            <Button onClick={rotateSelection} disabled={selectionCount === 0} title="R">
              Rotate
            </Button>
            <Button onClick={duplicateSelection} disabled={selectionCount === 0} title="Ctrl+D">
              Duplicate
            </Button>
            <Button
              variant="danger"
              onClick={deleteSelection}
              disabled={selectionCount === 0}
              title="Delete"
            >
              Delete
            </Button>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            {selectionCount === 0
              ? 'Nothing selected.'
              : `${selectionCount} panel${selectionCount === 1 ? '' : 's'} selected.`}
          </p>
        </section>
      )}

      <section>
        <SectionTitle>Plot</SectionTitle>
        <dl className="space-y-1 text-xs text-slate-600">
          <Row label="Area" value={`${plotAreaSqFt(plot).toLocaleString('en-IN')} sq ft`} />
          <Row label="Boundary" value={edges.map((e) => formatFt(e)).join(' × ')} />
          <Row label="Wall height" value={formatFt(WALL_HEIGHT_FT)} />
        </dl>
        {!readOnly && (
          <div className="mt-2">
            <Button onClick={onEditPlot}>Edit plot boundary</Button>
          </div>
        )}
      </section>
    </aside>
  );
}

function ToolButton({
  active,
  onClick,
  label,
  hint,
  disabled,
}: {
  active: boolean;
  onClick(): void;
  label: string;
  hint: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md border px-2.5 py-2 text-left transition disabled:cursor-not-allowed disabled:opacity-40 ${
        active ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:bg-slate-50'
      }`}
    >
      <span className="block text-sm font-medium text-slate-800">{label}</span>
      <span className="mt-0.5 block text-xs leading-snug text-slate-500">{hint}</span>
    </button>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-medium text-slate-700">{value}</dd>
    </div>
  );
}
