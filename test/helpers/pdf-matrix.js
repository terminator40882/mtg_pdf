/**
 * Read the effective placement matrix of the image on a PDF page.
 *
 * fpdf2 writes one combined operator ("179.12 0 0 249.73 37.31 2.27 cm") while pdf-lib
 * emits a translate and a scale separately. Composing every `cm` in the content stream
 * makes the comparison independent of how a library chunks its operators.
 */
import { decodePDFRawStream } from 'pdf-lib';

/**
 * Combine two PDF matrices [a,b,c,d,e,f] into "first `a`, then `b`" (row-vector form).
 */
export function applyThen(m1, m2) {
  const [a1, b1, c1, d1, e1, f1] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;
  return [
    a1 * a2 + b1 * c2,
    a1 * b2 + b1 * d2,
    c1 * a2 + d1 * c2,
    c1 * b2 + d1 * d2,
    e1 * a2 + f1 * c2 + e2,
    e1 * b2 + f1 * d2 + f2,
  ];
}

/**
 * Net transform of a sequence of `cm` operators in stream order.
 *
 * Each `cm` does CTM' = M x CTM, so with p' = p x CTM the matrix written last is the
 * one applied first — hence the reverse fold.
 */
export function composeMatrices(matrices) {
  if (!matrices.length) return [1, 0, 0, 1, 0, 0];
  return matrices.slice(0, -1).reduceRight(
    (acc, m) => applyThen(acc, m),
    matrices[matrices.length - 1],
  );
}

/** Inflated text of a page's content stream(s). */
export function pageContent(pdf, pageIndex) {
  const page = pdf.getPage(pageIndex);
  const context = page.node.context;
  const contents = context.lookup(page.node.Contents());
  // Duck-typed rather than `instanceof PDFArray`: that breaks as soon as the caller
  // loaded a different pdf-lib build (esm vs cjs) than this module did.
  const streams =
    typeof contents?.asArray === 'function'
      ? contents.asArray().map((ref) => context.lookup(ref))
      : [contents];
  return streams
    .map((stream) => Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1'))
    .join('\n');
}

/**
 * Effective [a,b,c,d,e,f] applied to the drawn image on `pageIndex`.
 * The image occupies the unit square, so a=width, d=height, e=x, f=y.
 */
export function imageMatrix(pdf, pageIndex) {
  const content = pageContent(pdf, pageIndex);
  if (!/\bDo\b/.test(content)) {
    throw new Error(`no image drawn on page ${pageIndex}: ${content}`);
  }
  const matrices = [...content.matchAll(/(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) cm/g)]
    .map((m) => m.slice(1).map(Number));
  if (!matrices.length) throw new Error(`no cm operator on page ${pageIndex}: ${content}`);
  const [a, b, c, d, e, f] = composeMatrices(matrices);
  return { a, b, c, d, e, f, width: a, height: d, x: e, y: f };
}
