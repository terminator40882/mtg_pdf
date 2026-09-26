/**
 * Parity tests for src/geometry.js.
 *
 * The expected numbers are not re-derived here — they were read out of a PDF built by
 * the original Python pipeline (old/src/pdf_build.py with Pillow + fpdf2) for the
 * 2187x2975 sample card. fpdf2 emitted the placement matrix
 *     179.12 0 0 249.73 37.31 2.27 cm
 * i.e. width 179.12pt, height 249.73pt at x=37.31pt, y=2.27pt, and Pillow reported the
 * cropped image as 1999x2787. Any change that breaks these numbers changes the print
 * output, so they are pinned deliberately.
 */
import { describe, expect, it } from 'vitest';
import {
  BASE_HEIGHT_MM,
  BASE_WIDTH_MM,
  CARD_MM,
  CORNER_RADIUS_BASE_MM,
  DEFAULT_TARGET,
  LINUX_BORDER_MM,
  LINUX_LIFT_MM,
  LINUX_SIZE_BOOST_MM,
  LINUX_SIZE_CORRECTION,
  OVERSCAN,
  PAGE_MM,
  PT_PER_MM,
  TARGET_LINUX,
  TARGET_WINDOWS,
  aspectPlacementPt,
  cardPlacementPt,
  overscanPlacementPt,
  MAX_CANVAS_SIDE,
  MAX_IMAGES,
  MAX_TOTAL_BYTES,
  PADDING_BASE_MM,
  PAGE_SIZE_PT,
  PT_PER_INCH,
  canvasFitScale,
  cardHeightInch,
  cardWidthInch,
  clampCornerDelta,
  clampPaddingDelta,
  cornerRadiusPx,
  cropRect,
  effectivePaddingMm,
  limitError,
  mm2inch,
  mm2pixel,
  placementXInch,
  reorder,
} from '../src/geometry.js';

const SAMPLE_W = 2187;
const SAMPLE_H = 2975;

describe('mm2inch', () => {
  it('divides by 25.6, not 25.4', () => {
    // Deliberate quirk of the original; "fixing" it to 25.4 shifts every card by ~0.8%.
    expect(mm2inch(25.6)).toBe(1);
    expect(mm2inch(25.4)).not.toBe(1);
  });
});

describe('page and card geometry', () => {
  it('uses a 252pt square page for 3.5in', () => {
    expect(PAGE_SIZE_PT).toBe(252);
  });

  it('matches the card height fpdf2 emitted (249.73pt)', () => {
    expect(cardHeightInch()).toBeCloseTo(3.4684375, 10);
    expect(cardHeightInch() * PT_PER_INCH).toBeCloseTo(249.7275, 4);
  });

  it('matches the x placement fpdf2 emitted (37.31pt)', () => {
    expect(placementXInch()).toBeCloseTo(0.51822265625, 10);
    expect(placementXInch() * PT_PER_INCH).toBeCloseTo(37.3120312, 4);
  });

  it('leaves 2.27pt below the card, since fpdf2 draws from the top edge', () => {
    expect(PAGE_SIZE_PT - cardHeightInch() * PT_PER_INCH).toBeCloseTo(2.2725, 4);
  });

  it('derives the width from the cropped aspect ratio, not from BASE_WIDTH_MM', () => {
    // pdf.image(h=..., keep_aspect_ratio=True) without w makes fpdf2 compute
    // w = h * imgW/imgH, so BASE_WIDTH_MM only positions the card.
    expect(cardWidthInch(1999, 2787) * PT_PER_INCH).toBeCloseTo(179.12, 2);
    expect(cardWidthInch(1999, 2787) * PT_PER_INCH).not.toBeCloseTo(
      mm2inch(BASE_WIDTH_MM) * PT_PER_INCH,
      2,
    );
  });

  it('scales the width with the source aspect ratio', () => {
    const square = cardWidthInch(1000, 1000);
    const wide = cardWidthInch(2000, 1000);
    expect(wide).toBeCloseTo(square * 2, 10);
  });
});

describe('mm2pixel', () => {
  it('scales millimetres by the image height over BASE_HEIGHT_MM', () => {
    expect(mm2pixel(BASE_HEIGHT_MM, SAMPLE_H)).toBeCloseTo(SAMPLE_H, 6);
    expect(mm2pixel(PADDING_BASE_MM, SAMPLE_H)).toBeCloseTo(93.81476, 5);
  });
});

describe('cropRect', () => {
  it('reproduces Pillow\'s 1999x2787 crop of the sample card', () => {
    expect(cropRect(SAMPLE_W, SAMPLE_H, PADDING_BASE_MM)).toEqual({
      sx: 94,
      sy: 94,
      sw: 1999,
      sh: 2787,
    });
  });

  it('rounds each edge independently, like Pillow Image._crop', () => {
    // Pillow does map(int, map(round, (left, top, right, bottom))), so the right edge is
    // rounded as (imgW - cutoff) rather than the cutoff being rounded once and doubled.
    // At a cutoff of exactly x.5 the two differ by a pixel:
    const cutoff = mm2pixel(1.1, 1009);
    expect(cutoff).toBeCloseTo(12.5, 6);
    expect(cropRect(909, 1009, 1.1).sw).toBe(884); // round(896.5) - round(12.5)
    expect(909 - 2 * Math.round(cutoff)).toBe(883); // what rounding once would give
  });

  it('returns the full image for zero padding', () => {
    expect(cropRect(100, 200, 0)).toEqual({ sx: 0, sy: 0, sw: 100, sh: 200 });
  });

  it('returns null when the padding consumes the image', () => {
    // 60mm of padding per side on a card only ~88.8mm tall leaves nothing.
    expect(cropRect(SAMPLE_W, SAMPLE_H, 60)).toBeNull();
  });
});

describe('cornerRadiusPx', () => {
  it('converts the base radius for the sample card', () => {
    expect(cornerRadiusPx(SAMPLE_H, CORNER_RADIUS_BASE_MM)).toBeCloseTo(67.0105, 4);
  });

  it('never goes negative', () => {
    expect(cornerRadiusPx(SAMPLE_H, -5)).toBe(0);
    expect(cornerRadiusPx(SAMPLE_H, 0)).toBe(0);
  });
});

describe('canvasFitScale', () => {
  it('leaves normal card scans untouched', () => {
    expect(canvasFitScale(SAMPLE_W, SAMPLE_H)).toBe(1);
  });

  it('shrinks images past the maximum side length', () => {
    const scale = canvasFitScale(MAX_CANVAS_SIDE * 2, 1000);
    expect(scale).toBeLessThan(1);
    expect(MAX_CANVAS_SIDE * 2 * scale).toBeLessThanOrEqual(MAX_CANVAS_SIDE);
  });

  it('shrinks images past the maximum area even when both sides are legal', () => {
    const scale = canvasFitScale(12000, 12000);
    expect(scale).toBeLessThan(1);
    expect(12000 * scale * (12000 * scale)).toBeLessThanOrEqual(64 * 1000 * 1000 + 1);
  });
});

describe('reorder', () => {
  it('moves an entry forward', () => {
    expect(reorder([0, 1, 2, 3], 0, 2)).toEqual([1, 2, 0, 3]);
  });

  it('moves an entry backward', () => {
    expect(reorder([0, 1, 2, 3], 3, 1)).toEqual([0, 3, 1, 2]);
  });

  it('is a no-op for equal indices and never mutates the input', () => {
    const input = [0, 1, 2];
    expect(reorder(input, 1, 1)).toEqual([0, 1, 2]);
    reorder(input, 0, 2);
    expect(input).toEqual([0, 1, 2]);
  });
});

describe('control clamping', () => {
  it('stops padding at 0mm', () => {
    expect(PADDING_BASE_MM + clampPaddingDelta(-0.1)).toBeCloseTo(2.7, 10);
    expect(PADDING_BASE_MM + clampPaddingDelta(-99)).toBe(0);
  });

  it('stops the corner radius at 0mm', () => {
    expect(CORNER_RADIUS_BASE_MM + clampCornerDelta(-0.1)).toBeCloseTo(1.9, 10);
    expect(CORNER_RADIUS_BASE_MM + clampCornerDelta(-99)).toBe(0);
  });
});

describe('limitError', () => {
  it('accepts a selection that fits', () => {
    expect(limitError(0, 0, 10, 1024)).toBeNull();
    expect(limitError(MAX_IMAGES - 1, 0, 1, 0)).toBeNull();
    expect(limitError(0, MAX_TOTAL_BYTES - 1, 1, 1)).toBeNull();
  });

  it('rejects more than MAX_IMAGES images, counting the ones already added', () => {
    expect(limitError(0, 0, MAX_IMAGES + 1, 0)).toBe('Maximum 100 images allowed');
    expect(limitError(MAX_IMAGES, 0, 1, 0)).toBe('Maximum 100 images allowed');
    expect(limitError(60, 0, 41, 0)).toBe('Maximum 100 images allowed');
  });

  it('rejects a selection past the total byte budget', () => {
    expect(limitError(1, MAX_TOTAL_BYTES, 1, 1)).toBe('Total size exceeds 100 MB');
    expect(limitError(1, MAX_TOTAL_BYTES / 2, 1, MAX_TOTAL_BYTES / 2 + 1)).toBe(
      'Total size exceeds 100 MB',
    );
  });

  it('reports the image count first when both limits are blown', () => {
    expect(limitError(0, 0, MAX_IMAGES + 1, MAX_TOTAL_BYTES * 2)).toBe(
      'Maximum 100 images allowed',
    );
  });
});

describe('output targets', () => {
  // Cropped size of the 2187x2975 sample card at the default 2.8mm padding.
  const CROPPED_W = 1999;
  const CROPPED_H = 2787;
  const mm = (pt) => pt / PT_PER_MM;

  it('defaults to the Linux target', () => {
    expect(DEFAULT_TARGET).toBe(TARGET_LINUX);
  });

  it('keeps the page at 252pt for both targets', () => {
    // 3.5in and 88.9mm are the same length, so the page size is unchanged.
    expect(PAGE_MM * PT_PER_MM).toBeCloseTo(PAGE_SIZE_PT, 9);
  });

  describe('Linux (borderless overscan)', () => {
    // Crop is 0.7mm smaller on Linux, so the sample yields 2047x2835, not 1999x2787.
    const LINUX_W = 2047;
    const LINUX_H = 2835;

    it('derives the height from OVERSCAN, the 835/818 correction and the 0.6mm boost', () => {
      const { height } = overscanPlacementPt(LINUX_W, LINUX_H);
      const divisor = OVERSCAN * LINUX_SIZE_CORRECTION;
      expect(LINUX_SIZE_CORRECTION).toBeCloseTo(835 / 818, 12);
      expect(LINUX_SIZE_BOOST_MM).toBe(0.6);
      expect(mm(height)).toBeCloseTo(CARD_MM.height / divisor + LINUX_SIZE_BOOST_MM, 9);
      expect(mm(height)).toBeCloseTo(83.2831, 3);
    });

    it('is exactly 0.6mm taller than it would be without the boost', () => {
      const { height } = overscanPlacementPt(LINUX_W, LINUX_H);
      const divisor = OVERSCAN * LINUX_SIZE_CORRECTION;
      expect(mm(height) - CARD_MM.height / divisor).toBeCloseTo(LINUX_SIZE_BOOST_MM, 9);
      expect(mm(height)).toBeCloseTo(82.6831 + 0.6, 3);
    });

    it('scales 1:1 — the rectangle keeps the source aspect ratio', () => {
      for (const [w, h] of [[LINUX_W, LINUX_H], [295, 420], [1000, 1000], [3000, 1000]]) {
        const rect = overscanPlacementPt(w, h);
        expect(rect.width / rect.height).toBeCloseTo(w / h, 9);
      }
    });

    it('keeps the height fixed and lets only the width follow the source', () => {
      const tall = overscanPlacementPt(1000, 2000);
      const wide = overscanPlacementPt(2000, 2000);
      expect(wide.height).toBeCloseTo(tall.height, 9);
      expect(wide.width).toBeCloseTo(tall.width * 2, 9);
    });

    it('centres horizontally and lifts the centre by 1.3mm', () => {
      const { x, y, width, height } = overscanPlacementPt(LINUX_W, LINUX_H);
      const page = PAGE_MM * PT_PER_MM;
      expect(LINUX_LIFT_MM).toBe(1.3);
      // Left margin equals right margin.
      expect(x).toBeCloseTo(page - x - width, 9);
      expect(mm(x)).toBeCloseTo(14.3829, 3);
      // Vertically the card centre sits 1.3mm above the page centre.
      expect(mm(y + height / 2)).toBeCloseTo(PAGE_MM / 2 + LINUX_LIFT_MM, 9);
      expect(mm(y + height / 2)).toBeCloseTo(45.75, 6);
      // So the top margin is 2.6mm smaller than the bottom one.
      expect(mm(page - y - height)).toBeCloseTo(1.5085, 3);
      expect(mm(y)).toBeCloseTo(4.1085, 3);
      expect(mm(y) - mm(page - y - height)).toBeCloseTo(2 * LINUX_LIFT_MM, 9);
    });

    it('stays inside the page for a normal card scan', () => {
      const { x, y, width, height } = overscanPlacementPt(LINUX_W, LINUX_H);
      const page = PAGE_MM * PT_PER_MM;
      expect(x).toBeGreaterThan(0);
      expect(y).toBeGreaterThan(0);
      expect(x + width).toBeLessThan(page);
      expect(y + height).toBeLessThan(page);
    });

    it('is what cardPlacementPt returns for the Linux target', () => {
      expect(cardPlacementPt(TARGET_LINUX, CROPPED_W, CROPPED_H)).toEqual(
        overscanPlacementPt(CROPPED_W, CROPPED_H),
      );
    });
  });

  describe('Windows (unchanged fpdf2 layout)', () => {
    it('still matches the matrix fpdf2 emitted', () => {
      const { x, y, width, height } = aspectPlacementPt(CROPPED_W, CROPPED_H);
      expect(width).toBeCloseTo(179.12, 2);
      expect(height).toBeCloseTo(249.7275, 4);
      expect(x).toBeCloseTo(37.3120312, 4);
      expect(y).toBeCloseTo(2.2725, 4);
    });

    it('still follows the source aspect ratio', () => {
      expect(aspectPlacementPt(2000, 1000).width).toBeCloseTo(
        aspectPlacementPt(1000, 1000).width * 2,
        9,
      );
    });

    it('is what cardPlacementPt returns for the Windows target', () => {
      expect(cardPlacementPt(TARGET_WINDOWS, CROPPED_W, CROPPED_H)).toEqual(
        aspectPlacementPt(CROPPED_W, CROPPED_H),
      );
    });
  });

  it('draws the Linux card smaller and higher than the Windows one', () => {
    const linux = cardPlacementPt(TARGET_LINUX, CROPPED_W, CROPPED_H);
    const windows = cardPlacementPt(TARGET_WINDOWS, CROPPED_W, CROPPED_H);
    expect(linux.width).toBeLessThan(windows.width);
    expect(linux.height).toBeLessThan(windows.height);
    expect(linux.y).toBeGreaterThan(windows.y); // pdf-lib y grows upwards
    // Both keep the source aspect ratio now, so they differ only by scale and position.
    expect(linux.width / linux.height).toBeCloseTo(windows.width / windows.height, 9);
  });
});

describe('effectivePaddingMm', () => {
  it('crops 0.7mm less on Linux, leaving that much extra black border', () => {
    expect(LINUX_BORDER_MM).toBe(0.7);
    expect(effectivePaddingMm(TARGET_LINUX, PADDING_BASE_MM)).toBeCloseTo(2.1, 9);
    expect(effectivePaddingMm(TARGET_LINUX, 5)).toBeCloseTo(4.3, 9);
  });

  it('leaves the Windows target alone', () => {
    expect(effectivePaddingMm(TARGET_WINDOWS, PADDING_BASE_MM)).toBe(PADDING_BASE_MM);
    expect(effectivePaddingMm(TARGET_WINDOWS, 0)).toBe(0);
  });

  it('never returns a negative crop, which would grow the frame', () => {
    expect(effectivePaddingMm(TARGET_LINUX, 0)).toBe(0);
    expect(effectivePaddingMm(TARGET_LINUX, 0.3)).toBe(0);
  });

  it('keeps more pixels than the requested padding would', () => {
    const asked = cropRect(2187, 2975, PADDING_BASE_MM);
    const linux = cropRect(2187, 2975, effectivePaddingMm(TARGET_LINUX, PADDING_BASE_MM));
    expect(linux.sw).toBeGreaterThan(asked.sw);
    expect(linux.sh).toBeGreaterThan(asked.sh);
    expect(linux.sx).toBeLessThan(asked.sx);
  });
});
