/**
 * The numeric control rows: crop padding, corner radius, and the print-alignment
 * offsets. Owns their values; the caller asks for them when building a PDF.
 *
 * Padding and corner radius are per-batch choices and are cleared by resetBatch().
 * The offsets calibrate a printer, so they deliberately survive it.
 */
import {
  CORNER_RADIUS_BASE_MM,
  LINUX_LIFT_MM,
  LINUX_SHIFT_MM,
  PADDING_BASE_MM,
  clampCornerDelta,
  clampOffsetMm,
  clampPaddingDelta,
} from './geometry.js';

const STEP = 0.1;

const el = (id) => document.getElementById(id);

/**
 * @param {{onChange?: () => void}} handlers called whenever a value moves, so a PDF
 *   built with the old settings can be discarded.
 */
export function createControls({ onChange = () => {} } = {}) {
  let paddingDelta = 0;
  let cornerDelta = 0;
  let offsetXDelta = 0;
  let offsetYDelta = 0;

  const paddingValue = el('paddingValue');
  const cornerValue = el('cornerValue');
  const offsetXValue = el('offsetXValue');
  const offsetYValue = el('offsetYValue');
  const offsetXRow = el('offsetXRow');
  const offsetYRow = el('offsetYRow');

  function render() {
    paddingValue.textContent = (PADDING_BASE_MM + paddingDelta).toFixed(1);
    cornerValue.textContent = (CORNER_RADIUS_BASE_MM + cornerDelta).toFixed(1);
    offsetXValue.textContent = (LINUX_SHIFT_MM + offsetXDelta).toFixed(1);
    offsetYValue.textContent = (LINUX_LIFT_MM + offsetYDelta).toFixed(1);
  }

  function bind(id, apply) {
    el(id).addEventListener('click', () => {
      apply();
      render();
      onChange();
    });
  }

  bind('paddingMinus', () => { paddingDelta = clampPaddingDelta(paddingDelta - STEP); });
  bind('paddingPlus', () => { paddingDelta += STEP; });
  bind('cornerMinus', () => { cornerDelta = clampCornerDelta(cornerDelta - STEP); });
  bind('cornerPlus', () => { cornerDelta += STEP; });
  // Positive x moves the card right, positive y moves it up.
  bind('offsetXMinus', () => { offsetXDelta = clampOffsetMm(offsetXDelta - STEP); });
  bind('offsetXPlus', () => { offsetXDelta = clampOffsetMm(offsetXDelta + STEP); });
  bind('offsetYMinus', () => { offsetYDelta = clampOffsetMm(offsetYDelta - STEP); });
  bind('offsetYPlus', () => { offsetYDelta = clampOffsetMm(offsetYDelta + STEP); });

  render();

  return {
    /** Everything buildPdf needs from this panel. */
    values: () => ({
      paddingMm: PADDING_BASE_MM + paddingDelta,
      cornerMm: CORNER_RADIUS_BASE_MM + cornerDelta,
      offsetXMm: offsetXDelta,
      offsetYMm: offsetYDelta,
    }),
    /** Clear the per-batch values, keeping the printer alignment. */
    resetBatch() {
      paddingDelta = 0;
      cornerDelta = 0;
      render();
    },
    /** The offsets only affect the Linux target, so hide them elsewhere. */
    showAlignment(visible) {
      offsetXRow.hidden = !visible;
      offsetYRow.hidden = !visible;
    },
  };
}
