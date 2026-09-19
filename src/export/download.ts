/** Browser download helpers shared by the CSV, JSON and PNG exports. */

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
