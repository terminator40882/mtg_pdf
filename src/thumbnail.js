/**
 * Canvas port of _make_thumbnail() from old/src/app.py.
 * Produces a data URL rather than an object URL: there is no lifetime to manage
 * and therefore no way for a preview to break by being revoked too early.
 */
import { THUMBNAIL_MAX_SIZE } from './geometry.js';

export const THUMBNAIL_QUALITY = 0.85;

/** Fit the bitmap into THUMBNAIL_MAX_SIZE (never upscaling) on a white ground. */
export function makeThumbnailDataUrl(bitmap, canvas) {
  const scale = Math.min(1, THUMBNAIL_MAX_SIZE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  canvas.width = width;
  canvas.height = height;
  // Matches the RGBA -> white compositing the Pillow version did before saving JPEG.
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);

  return canvas.toDataURL('image/jpeg', THUMBNAIL_QUALITY);
}
