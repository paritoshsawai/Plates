/**
 * Loading a scanned plan to trace over.
 *
 * The image is downscaled before it is ever stored. A photo straight off a
 * phone base64-encodes to several megabytes, and the whole localStorage budget
 * is about five, so an un-resized underlay would silently break saving the plan
 * it belongs to. Re-encoding as JPEG at a bounded size keeps a traced plan the
 * same order of size as an untraced one.
 */

/** Longest edge, in pixels, an underlay is stored at. */
export const MAX_UNDERLAY_PX = 2000;

export const UNDERLAY_JPEG_QUALITY = 0.82;

export interface LoadedUnderlay {
  dataUrl: string;
  widthPx: number;
  heightPx: number;
  name: string;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('The file could not be read.'));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('That file is not an image the browser can open.'));
    image.src = src;
  });
}

/** Scale factor that brings the longest edge down to `maxPx`, never above 1. */
export function downscaleFactor(width: number, height: number, maxPx = MAX_UNDERLAY_PX): number {
  const longest = Math.max(width, height);
  return longest <= maxPx ? 1 : maxPx / longest;
}

/**
 * Read an image file and return it downscaled, as a JPEG data URL.
 * Rejects with a readable message rather than throwing something opaque.
 */
export async function loadUnderlayFile(file: File): Promise<LoadedUnderlay> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Upload a PNG or JPG. PDF plans need exporting to an image first.');
  }

  const original = await readAsDataUrl(file);
  const image = await loadImage(original);

  const factor = downscaleFactor(image.naturalWidth, image.naturalHeight);
  const width = Math.max(1, Math.round(image.naturalWidth * factor));
  const height = Math.max(1, Math.round(image.naturalHeight * factor));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser could not process the image.');

  // A scan is usually white paper; flattening onto white keeps a transparent
  // PNG from turning black when it becomes a JPEG.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  return {
    dataUrl: canvas.toDataURL('image/jpeg', UNDERLAY_JPEG_QUALITY),
    widthPx: width,
    heightPx: height,
    name: file.name,
  };
}

/**
 * Grid units per image pixel, from two points clicked on the image and the
 * real distance between them.
 *
 * Calibration is the whole point of the underlay: a scan has no inherent
 * scale, and tracing an uncalibrated image would produce a building of the
 * wrong size with no warning.
 */
export function calibrationScale(
  pixelDistance: number,
  realFeet: number,
  gridFt: number,
): number | null {
  if (!(pixelDistance > 0) || !(realFeet > 0)) return null;
  const realUnits = realFeet / gridFt;
  return realUnits / pixelDistance;
}
