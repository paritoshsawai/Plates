import {
  ALL_CATEGORIES,
  CATEGORY_STYLE,
  FILLABLE_CATEGORIES,
  OPENING_CATEGORIES,
  PANEL_CATALOG,
  PLACEABLE_CATEGORIES,
} from '../core/panels';
import type { PanelCategory } from '../core/types';
import { GRID_FT, WALL_HEIGHT_FT, formatArea, formatLength } from '../core/units';
import { plotAreaSqFt, plotEdgeLengthsFt } from '../core/plot';
import { useStore } from '../state/store';
import { useCoarsePointer } from './useMediaQuery';
import { Button, CollapsibleSection, SectionTitle } from './ui';

interface Props {
  onEditPlot(): void;
  onEditUnderlay(): void;
  /**
   * Which half of the rail to render.
   *
   * On a desktop this is left alone and the whole rail shows, exactly as it
   * always has. The bottom sheet uses it to put drawing and visibility behind
   * separate tabs, because the full rail is eight sections and that is a long
   * scroll on a phone.
   */
  only?: 'draw' | 'layers';
}

export function LeftRail({ onEditPlot, onEditUnderlay, only }: Props) {
  const touch = useCoarsePointer();
  const showDraw = only !== 'layers';
  const showLayers = only !== 'draw';
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
  const fillArea = useStore((s) => s.fillArea);
  const areaAxis = useStore((s) => s.areaAxis);
  const setAreaAxis = useStore((s) => s.setAreaAxis);
  const clearArea = useStore((s) => s.clearArea);
  const hiddenLayers = useStore((s) => s.hiddenLayers);
  const toggleLayer = useStore((s) => s.toggleLayer);
  const showAllLayers = useStore((s) => s.showAllLayers);
  const underlay = useStore((s) => s.plan.underlay);

  const countIn = (category: PanelCategory) =>
    panels.filter((p) => p.category === category).length;

  // Splitting only means anything for a 4 ft panel.
  const splittable = selection.filter(
    (id) => panels.find((p) => p.id === id)?.size === '4x10',
  );

  const readOnly = role === 'client';
  const edges = plotEdgeLengthsFt(plot);
  const unit = useStore((s) => s.unit);

  return (
    <aside className="flex w-full shrink-0 flex-col gap-5 border-t border-slate-200 bg-white p-4 lg:w-60 lg:overflow-y-auto lg:border-t-0 lg:border-r">
      {showDraw && (
      <section>
        <SectionTitle>Tools</SectionTitle>
        <div className="grid gap-1.5">
          <ToolButton
            active={tool === 'room'}
            disabled={readOnly}
            onClick={() => setTool('room')}
            label="Draw room"
            hint={
              touch
                ? 'Drag out a rectangle and all four walls are built at once.'
                : 'Drag out a rectangle, or click two opposite corners. All four walls are built at once.'
            }
          />
          <ToolButton
            active={tool === 'wall'}
            disabled={readOnly}
            onClick={() => setTool('wall')}
            label="Draw wall"
            hint={
              touch
                ? 'Drag from one end to the other. The ring shows where it will land.'
                : 'Click two points, or drag from one end to the other; the run is auto-filled with the fewest panels.'
            }
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
            label="Select & move"
            hint={
              touch
                ? 'Tap a panel to select it. Hold one down for more, including delete.'
                : 'Drag a panel to move it, or drag the background to box-select. Hold Space to pan.'
            }
          />
        </div>
      </section>
      )}

      {showDraw && (
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
      )}

      {showDraw && (
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
      )}



      {!readOnly && showLayers && (
        <section>
          <SectionTitle>Floor &amp; roof</SectionTitle>
          <div className="grid gap-1.5">
            {FILLABLE_CATEGORIES.map((category) => {
              const count = countIn(category);
              return (
                <div key={category} className="rounded-md border border-slate-200 px-2.5 py-2">
                  <div className="flex items-center gap-2">
                    <span
                      className="h-3 w-3 shrink-0 rounded-sm"
                      style={{ backgroundColor: CATEGORY_STYLE[category].color }}
                    />
                    <span className="flex-1 text-sm text-slate-700">
                      {CATEGORY_STYLE[category].plural}
                    </span>
                    <span className="text-xs tabular-nums text-slate-500">{count}</span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <Button onClick={() => fillArea(category, areaAxis[category])}>
                      {count > 0 ? 'Refill' : 'Fill'}
                    </Button>
                    {count > 0 && (
                      <Button variant="danger" onClick={() => clearArea(category)}>
                        Clear
                      </Button>
                    )}
                  </div>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <span className="text-xs text-slate-500">Strips</span>
                    {(
                      [
                        ['h', '\u2194', 'across'],
                        ['v', '\u2195', 'down'],
                      ] as const
                    ).map(([axis, glyph, label]) => (
                      <button
                        key={axis}
                        type="button"
                        onClick={() => setAreaAxis(category, axis)}
                        title={`Run the 10 ft strips ${label} the plan`}
                        aria-label={`${CATEGORY_STYLE[category].plural}: strips ${label}`}
                        aria-pressed={areaAxis[category] === axis}
                        className={`rounded border px-2 py-0.5 text-xs leading-5 ${
                          areaAxis[category] === axis
                            ? 'border-slate-900 bg-slate-900 text-white'
                            : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        {glyph}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-xs leading-snug text-slate-500">
            Panels lie flat here, so their 10 ft dimension is in plan: they fill the building in
            10 ft strips. Anything shallower than 10 ft is reported, never approximated. Fill picks
            the strip direction that covers most of the building; the arrows re-lay it the other
            way.
          </p>
        </section>
      )}

      {!readOnly && showDraw && (
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

      {!readOnly && showDraw && (
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
              ? 'Nothing selected. Drag a box on the plan, or shift-click, to pick several.'
              : `${selectionCount} panel${selectionCount === 1 ? '' : 's'} selected. Arrow keys nudge the whole selection 2 ft.`}
          </p>
        </section>
      )}

      {showDraw && (
      <section>
        <SectionTitle>Plot</SectionTitle>
        <dl className="space-y-1 text-xs text-slate-600">
          <Row label="Area" value={formatArea(plotAreaSqFt(plot), unit)} />
          <Row label="Boundary" value={edges.map((e) => formatLength(e, unit)).join(' × ')} />
          <Row label="Wall height" value={formatLength(WALL_HEIGHT_FT, unit)} />
        </dl>
        {!readOnly && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Button onClick={onEditPlot}>Edit plot boundary</Button>
            <Button onClick={onEditUnderlay}>
              {underlay ? 'Underlay\u2026' : 'Trace a plan\u2026'}
            </Button>
          </div>
        )}
      </section>
      )}
      {showLayers && (
        <CollapsibleSection
          title="Layers"
          summary={hiddenLayers.length > 0 ? `${hiddenLayers.length} hidden` : 'all shown'}
        >
          <div className="grid gap-1">
            {ALL_CATEGORIES.map((category) => {
              const count = countIn(category);
              const hidden = hiddenLayers.includes(category);
              return (
                <button
                  key={category}
                  type="button"
                  onClick={() => toggleLayer(category)}
                  aria-pressed={!hidden}
                  // Names the action, not the state, which is what a toggle
                  // button should announce - and keeps it distinct from the
                  // strip buttons.
                  aria-label={`${hidden ? 'Show' : 'Hide'} ${CATEGORY_STYLE[category].plural}`}
                  className={`flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition hover:bg-slate-50 ${
                    hidden ? 'text-slate-400' : 'text-slate-700'
                  }`}
                >
                  <span
                    className="h-3 w-3 shrink-0 rounded-sm"
                    style={{
                      backgroundColor: CATEGORY_STYLE[category].color,
                      opacity: hidden ? 0.3 : 1,
                    }}
                  />
                  <span className="flex-1">{CATEGORY_STYLE[category].plural}</span>
                  <span className="tabular-nums text-xs text-slate-400">{count}</span>
                  <span className="w-10 shrink-0 text-right text-xs font-medium">
                    {hidden ? 'Show' : 'Hide'}
                  </span>
                </button>
              );
            })}
          </div>
          {hiddenLayers.length > 0 && (
            <div className="mt-1.5">
              <Button variant="ghost" onClick={showAllLayers}>
                Show all layers
              </Button>
            </div>
          )}
          <p className="mt-2 text-xs leading-snug text-slate-500">
            Hiding is a view control only. A hidden layer is still built, still validated and still
            priced &mdash; it just gets out of the way so you can see underneath.
          </p>
        </CollapsibleSection>
      )}
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
