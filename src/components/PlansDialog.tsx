import { useEffect } from 'react';
import { useStore } from '../state/store';
import { Button, Modal } from './ui';

interface Props {
  onClose(): void;
}

export function PlansDialog({ onClose }: Props) {
  const savedPlans = useStore((s) => s.savedPlans);
  const refresh = useStore((s) => s.refreshSavedPlans);
  const openPlan = useStore((s) => s.openPlan);
  const deleteSavedPlan = useStore((s) => s.deleteSavedPlan);
  const currentId = useStore((s) => s.plan.id);
  const dirty = useStore((s) => s.dirty);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <Modal title="Saved plans" onClose={onClose} footer={<Button onClick={onClose}>Close</Button>}>
      {dirty && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          The current plan has unsaved changes. Opening another plan discards them.
        </p>
      )}

      {savedPlans.length === 0 ? (
        <p className="text-sm text-slate-500">
          Nothing saved yet. Use <strong>Save version</strong> to store a plan in this browser.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {savedPlans.map((summary) => (
            <li key={summary.id} className="flex items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-800">
                  {summary.name}
                  {summary.id === currentId && (
                    <span className="ml-2 rounded bg-blue-100 px-1.5 py-0.5 text-xs font-normal text-blue-700">
                      open
                    </span>
                  )}
                </p>
                <p className="text-xs text-slate-500">
                  v{summary.version} &middot; {summary.panelCount} panels &middot;{' '}
                  {new Date(summary.updatedAt).toLocaleString('en-IN')}
                </p>
              </div>
              <Button
                onClick={() => {
                  openPlan(summary.id);
                  onClose();
                }}
              >
                Open
              </Button>
              <Button variant="danger" onClick={() => deleteSavedPlan(summary.id)}>
                Delete
              </Button>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs leading-relaxed text-slate-500">
        Plans are stored in this browser only. Use <strong>Export &rarr; Plan JSON</strong> to move
        one between machines; the same document shape is what a server would persist.
      </p>
    </Modal>
  );
}
