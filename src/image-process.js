/**
 * Canvas port of process_image() from old/src/pdf_build.py.
 * Crops the padding, rounds the corners and encodes one card as JPEG.
 */
import { cropRect, cornerRadiusPx, canvasFitScale } from './geometry.js';

export const JPEG_QUALITY = 0.95;

/** Trace a rounded rectangle, falling back to arcTo where roundRect is missing. */
export function roundRectPath(ctx, x, y, w, h, radius) {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('canvas could not be encoded'))),
      type,
      quality,
    );
  });
}

/**
 * Render one card: crop by `paddingMm`, clip to rounded corners, encode as JPEG.
 * The caller owns `bitmap` and `canvas`; both are left for the caller to release.
 *
 * Returns { blob, width, height, scaled } where width/height are the encoded pixel
 * dimensions the PDF aspect ratio has to be derived from.
 */
export async function renderCardJpeg(bitmap, paddingMm, cornerMm, canvas, quality = JPEG_QUALITY) {
  const rect = cropRect(bitmap.width, bitmap.height, paddingMm);
  if (!rect) {
    throw new Error(`padding of ${paddingMm.toFixed(1)}mm leaves no image to crop`);
  }
  const radius = cornerRadiusPx(bitmap.height, cornerMm);

  // Oversized scans would render as a blank canvas, so shrink them to fit instead.
  const scale = canvasFitScale(rect.sw, rect.sh);
  const width = Math.max(1, Math.round(rect.sw * scale));
  const height = Math.max(1, Math.round(rect.sh * scale));

  canvas.width = width;
  canvas.height = height;
  // alpha:false — JPEG has no alpha channel and a transparent canvas would be
  // composited onto black, so the frame is opaque and painted white up front.
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.beginPath();
  roundRectPath(ctx, 0, 0, width, height, radius * scale);
  ctx.clip();
  ctx.drawImage(bitmap, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, width, height);
  ctx.restore();

  const blob = await canvasToBlob(canvas, 'image/jpeg', quality);
  return { blob, width, height, scaled: scale < 1 };
}
