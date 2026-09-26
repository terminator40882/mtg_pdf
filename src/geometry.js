/**
 * Pure geometry and limits, ported 1:1 from old/src/pdf_build.py and old/src/app.py.
 * No DOM access here so the maths stays unit-testable in Node.
 */

/** Deliberate quirk of the original: 25.6, not 25.4. Do not "fix" this. */
export function mm2inch(mm) {
  return mm / 25.6;
}

export const PT_PER_INCH = 72;

// --- Card dimensions (pdf_build.py) ---
export const PDF_SIZE_INCH = 3.5;
export const FACTOR = 1.009;
export const BASE_WIDTH_MM = 63 * FACTOR;
export const BASE_HEIGHT_MM = 88 * FACTOR;
export const X_OFFSET_MM = 0.25;

// --- Adjustable defaults (app.py) ---
export const PADDING_BASE_MM = 2.8;
export const CORNER_RADIUS_BASE_MM = 2;

// --- Limits (app.py: MAX_IMAGES / MAX_CONTENT_LENGTH / THUMBNAIL_MAX_SIZE) ---
export const MAX_IMAGES = 100;
export const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
export const THUMBNAIL_MAX_SIZE = 200;

/** Browser canvas ceilings; beyond these a canvas silently renders blank. */
export const MAX_CANVAS_SIDE = 16384;
export const MAX_CANVAS_AREA = 64 * 1000 * 1000;

/** Page side in points. The PDF page is square: 3.5in -> 252pt. */
export const PAGE_SIZE_PT = PDF_SIZE_INCH * PT_PER_INCH;

// --- Output targets ---------------------------------------------------------------
//
// Both targets use the same 252pt square page (3.5in and 88.9mm are the same thing) and
// the same cropped, rounded card image. Only the rectangle the image is drawn into
// differs.

export const TARGET_LINUX = 'linux';
export const TARGET_WINDOWS = 'windows';
export const DEFAULT_TARGET = TARGET_LINUX;

/** Points per millimetre - the real conversion, unlike mm2inch's deliberate 25.6. */
export const PT_PER_MM = 72 / 25.4;
/** 89x89mm cardstock. 88.9mm x PT_PER_MM is the same 252pt as 3.5in. */
export const PAGE_MM = 88.9;
/** Finished size the card should have once the printer has done its thing. */
export const CARD_MM = { width: 63.5, height: 88.9 };
/** Measured borderless overscan of the Canon G600. */
export const OVERSCAN = 1.0533;
/** Measured size correction applied on top of OVERSCAN. */
export const LINUX_SIZE_CORRECTION = 835 / 818;
/** The card centre sits this far above the page centre. */
export const LINUX_LIFT_MM = 1.3;
/** Crop this much less than asked for, so more of the black border survives. */
export const LINUX_BORDER_MM = 0.7;

/** Drawn card height. Always BASE_HEIGHT_MM, independent of the source image. */
export function cardHeightInch() {
  return mm2inch(BASE_HEIGHT_MM);
}

/** Horizontal placement: card centred on BASE_WIDTH_MM, then nudged by X_OFFSET_MM. */
export function placementXInch() {
  return (PDF_SIZE_INCH - mm2inch(BASE_WIDTH_MM)) / 2 + mm2inch(X_OFFSET_MM);
}

/**
 * Drawn card width.
 *
 * pdf_build.py calls pdf.image(..., h=..., keep_aspect_ratio=True) WITHOUT w, so
 * fpdf2 derives w = h * imgW/imgH and keep_aspect_ratio becomes a no-op. The width
 * therefore follows the cropped image's aspect ratio, NOT BASE_WIDTH_MM.
 */
export function cardWidthInch(croppedW, croppedH) {
  return cardHeightInch() * (croppedW / croppedH);
}

/** mm -> source pixels, scaled by the image's own height (process_image's mm2pixel). */
export function mm2pixel(mm, imgHeightPx) {
  return (mm * imgHeightPx) / BASE_HEIGHT_MM;
}

/**
 * Crop box for a uniform padding on all four sides.
 *
 * Each edge is rounded independently because Pillow's Image._crop does
 * `map(int, map(round, box))` on the (left, top, right, bottom) tuple.
 * Returns null when the padding would consume the whole image.
 */
export function cropRect(imgW, imgH, paddingMm) {
  const cutoff = mm2pixel(paddingMm, imgH);
  const left = Math.round(cutoff);
  const top = Math.round(cutoff);
  const right = Math.round(imgW - cutoff);
  const bottom = Math.round(imgH - cutoff);
  const sw = right - left;
  const sh = bottom - top;
  if (sw <= 0 || sh <= 0) return null;
  return { sx: left, sy: top, sw, sh };
}

/** Corner radius in source pixels, never negative. */
export function cornerRadiusPx(imgHeightPx, cornerMm) {
  return Math.max(0, mm2pixel(cornerMm, imgHeightPx));
}

/**
 * Placement for TARGET_LINUX: shrink the card by OVERSCAN so the printer's borderless
 * overscan blows it back up to CARD_MM, and centre it exactly so the bleed is eaten
 * symmetrically on all four sides.
 *
 * The image is stretched into this rectangle - its own aspect ratio is ignored, which is
 * what preserveAspectRatio=False / keep_proportion=False means in the reference code.
 */
export function overscanPlacementPt() {
  const divisor = OVERSCAN * LINUX_SIZE_CORRECTION;
  const width = (CARD_MM.width / divisor) * PT_PER_MM;
  const height = (CARD_MM.height / divisor) * PT_PER_MM;
  const page = PAGE_MM * PT_PER_MM;
  return {
    x: (page - width) / 2,
    // Centred, then lifted. pdf-lib's y grows upwards, so a positive offset moves up.
    y: (page - height) / 2 + LINUX_LIFT_MM * PT_PER_MM,
    width,
    height,
  };
}

/**
 * Placement for TARGET_WINDOWS: the original fpdf2 layout. Full BASE_HEIGHT_MM, width
 * following the cropped image's aspect ratio, flush with the top edge of the page.
 */
export function aspectPlacementPt(croppedW, croppedH) {
  const height = cardHeightInch() * PT_PER_INCH;
  return {
    x: placementXInch() * PT_PER_INCH,
    // fpdf2 draws at y=0 from the top; pdf-lib's origin is bottom-left.
    y: PAGE_SIZE_PT - height,
    width: cardWidthInch(croppedW, croppedH) * PT_PER_INCH,
    height,
  };
}

/**
 * Padding actually cropped for a target. The Linux target takes LINUX_BORDER_MM less
 * than asked for, leaving that much extra black border on the card. Never negative:
 * a negative crop would grow the frame instead of shrinking it.
 */
export function effectivePaddingMm(target, paddingMm) {
  return target === TARGET_LINUX ? Math.max(0, paddingMm - LINUX_BORDER_MM) : paddingMm;
}

/** Rectangle to draw the card into, in points, for the selected target. */
export function cardPlacementPt(target, croppedW, croppedH) {
  return target === TARGET_WINDOWS
    ? aspectPlacementPt(croppedW, croppedH)
    : overscanPlacementPt();
}

/**
 * Downscale factor keeping a canvas inside browser limits. 1 when it already fits.
 */
export function canvasFitScale(w, h) {
  const sideScale = Math.min(1, MAX_CANVAS_SIDE / Math.max(w, h));
  const areaScale = Math.min(1, Math.sqrt(MAX_CANVAS_AREA / (w * h)));
  return Math.min(sideScale, areaScale);
}

/** Move one entry of `order` from index `from` to index `to`, returning a new array. */
export function reorder(order, from, to) {
  if (from === to) return order.slice();
  const next = order.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * Reason a selection must be rejected, or null when it fits.
 * Mirrors the MAX_IMAGES and MAX_CONTENT_LENGTH checks the Flask upload route did.
 */
export function limitError(currentCount, currentBytes, addedCount, addedBytes) {
  if (currentCount + addedCount > MAX_IMAGES) {
    return `Maximum ${MAX_IMAGES} images allowed`;
  }
  if (currentBytes + addedBytes > MAX_TOTAL_BYTES) {
    return `Total size exceeds ${Math.round(MAX_TOTAL_BYTES / 1024 / 1024)} MB`;
  }
  return null;
}

/** Padding may not go below 0mm: negative padding makes Pillow/canvas grow the frame. */
export function clampPaddingDelta(delta) {
  return Math.max(-PADDING_BASE_MM, delta);
}

/** Corner radius may not go below 0mm (index.html clamped the delta at -2). */
export function clampCornerDelta(delta) {
  return Math.max(-CORNER_RADIUS_BASE_MM, delta);
}
