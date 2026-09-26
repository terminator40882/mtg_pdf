/** Unit tests for the matrix composition used by the end-to-end PDF assertions. */
import { describe, expect, it } from 'vitest';
import { applyThen, composeMatrices } from './helpers/pdf-matrix.js';

const IDENTITY = [1, 0, 0, 1, 0, 0];
const scale = (sx, sy) => [sx, 0, 0, sy, 0, 0];
const translate = (tx, ty) => [1, 0, 0, 1, tx, ty];

describe('applyThen', () => {
  it('keeps identity neutral on both sides', () => {
    expect(applyThen(IDENTITY, scale(2, 3))).toEqual(scale(2, 3));
    expect(applyThen(scale(2, 3), IDENTITY)).toEqual(scale(2, 3));
  });

  it('scales the translation of the second matrix by the first', () => {
    // Scaling by 2 and then translating by 5 is not the same as translating first.
    expect(applyThen(scale(2, 2), translate(5, 5))).toEqual([2, 0, 0, 2, 5, 5]);
    expect(applyThen(translate(5, 5), scale(2, 2))).toEqual([2, 0, 0, 2, 10, 10]);
  });
});

describe('composeMatrices', () => {
  it('is the identity for an empty sequence', () => {
    expect(composeMatrices([])).toEqual(IDENTITY);
  });

  it('collapses pdf-lib\'s operator sequence into fpdf2\'s single matrix', () => {
    // pdf-lib writes translate, identity, scale, identity; fpdf2 writes it in one go.
    const pdfLib = [
      translate(37.31, 2.27),
      IDENTITY,
      scale(179.12, 249.73),
      IDENTITY,
    ];
    const fpdf2 = [[179.12, 0, 0, 249.73, 37.31, 2.27]];
    expect(composeMatrices(pdfLib)).toEqual(composeMatrices(fpdf2));
    expect(composeMatrices(pdfLib)).toEqual([179.12, 0, 0, 249.73, 37.31, 2.27]);
  });

  it('applies the last operator first, per the PDF cm semantics', () => {
    // CTM' = M x CTM, so the matrix written last transforms the geometry first.
    expect(composeMatrices([translate(10, 0), scale(2, 2)])).toEqual([2, 0, 0, 2, 10, 0]);
  });
});
