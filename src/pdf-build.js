/**
 * Port of build_pdf() from old/src/pdf_build.py, using pdf-lib instead of fpdf2.
 * One card per 3.5in x 3.5in page, images processed strictly one at a time so peak
 * memory stays at a single decoded bitmap regardless of how many cards are queued.
 */
import { PDFDocument } from './vendor/pdf-lib.esm.min.js';
import {
  DEFAULT_TARGET,
  PAGE_SIZE_PT,
  cardPlacementPt,
  effectivePaddingMm,
} from './geometry.js';
import { renderCardJpeg } from './image-process.js';

/**
 * Build the PDF from `items` in the sequence given by `order` (indices into items).
 * `target` selects the page layout (see cardPlacementPt); `onProgress(done, total)` is
 * called after every page.
 * Returns { blob, downscaled } where `downscaled` counts images shrunk to fit the canvas.
 */
export async function buildPdf(
  items,
  order,
  { paddingMm, cornerMm, target = DEFAULT_TARGET, offsetXMm = 0, offsetYMm = 0 },
  onProgress = () => {},
) {
  if (!order.length) throw new Error('No images uploaded');

  const pdf = await PDFDocument.create();
  const canvas = document.createElement('canvas');
  const cropMm = effectivePaddingMm(target, paddingMm);

  let downscaled = 0;
  try {
    for (let n = 0; n < order.length; n += 1) {
      const item = items[order[n]];
      let bitmap = null;
      try {
        bitmap = await createImageBitmap(item.blob);
        const card = await renderCardJpeg(bitmap, cropMm, cornerMm, canvas);
        if (card.scaled) downscaled += 1;
        const image = await pdf.embedJpg(new Uint8Array(await card.blob.arrayBuffer()));
        const page = pdf.addPage([PAGE_SIZE_PT, PAGE_SIZE_PT]);
        page.drawImage(
          image,
          cardPlacementPt(target, card.width, card.height, { offsetXMm, offsetYMm }),
        );
      } catch (err) {
        throw new Error(`Invalid image '${item.filename}': ${err.message}`);
      } finally {
        // Release the decoded pixels immediately; never keep bitmaps around.
        bitmap?.close();
      }
      onProgress(n + 1, order.length);
    }
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }

  return { blob: new Blob([await pdf.save()], { type: 'application/pdf' }), downscaled };
}
