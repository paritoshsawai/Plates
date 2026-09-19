/** Browser download helpers shared by the CSV, JSON and PNG exports. */

/**
 * Whether the page is embedded, where a sandboxed host blocks any download the
 * page starts itself — the link click succeeds and nothing reaches the disk.
 * Callers offer a copy-to-clipboard route instead of a control that silently
 * does nothing.
 */
export function downloadsAreBlocked(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    // A cross-origin parent throws on access, which means embedded too.
    return true;
  }
}

/** Copy text to the clipboard. False when the host denies clipboard access. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  triggerDownload(url, filename);
  // Revoke on the next frame so Safari has had time to start the download.
  requestAnimationFrame(() => URL.revokeObjectURL(url));
}

export function downloadDataUrl(dataUrl: string, filename: string): void {
  triggerDownload(dataUrl, filename);
}

function triggerDownload(href: string, filename: string): void {
  const link = document.createElement('a');
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/** A filesystem-safe stem derived from the plan name. */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'plan';
}
