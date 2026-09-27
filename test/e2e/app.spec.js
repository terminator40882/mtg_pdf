/**
 * End-to-end tests against the static site: every step runs in a real browser, and the
 * generated PDF is parsed to confirm the page geometry the Python version produced.
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { PDFDocument, PDFName } from 'pdf-lib';
import { imageMatrix } from '../helpers/pdf-matrix.js';
import { LINUX_PRINT_COMMAND, NEWEST_DOWNLOAD } from '../../src/print-command.js';
import {
  PADDING_BASE_MM,
  TARGET_LINUX,
  TARGET_WINDOWS,
  cropRect,
  effectivePaddingMm,
} from '../../src/geometry.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CARD_A = resolve(HERE, '../fixtures/card-a.png');
const CARD_B = resolve(HERE, '../fixtures/card-b.jpg');

/** Fail the test on any console error or uncaught exception. */
function trackPageErrors(page) {
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}

/** Pixel dimensions of the first embedded image XObject. */
function embeddedImageSize(pdf) {
  for (const [, obj] of pdf.context.enumerateIndirectObjects()) {
    const dict = obj?.dict;
    if (!dict?.get) continue;
    const width = dict.get(PDFName.of('Width'));
    const height = dict.get(PDFName.of('Height'));
    if (width && height) return [width.asNumber(), height.asNumber()];
  }
  throw new Error('no image XObject in the PDF');
}

/** Click Generate, capture the download and return the parsed PDF plus its bytes. */
async function generateAndRead(page) {
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Generate PDF', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('mtg_cards.pdf');
  const path = await download.path();
  const bytes = await readFile(path);
  return { bytes, pdf: await PDFDocument.load(bytes), download };
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('shows a preview for an uploaded image', async ({ page }) => {
  const errors = trackPageErrors(page);
  await page.setInputFiles('#fileInput', CARD_A);

  await expect(page.locator('.preview-item')).toHaveCount(1);
  await expect(page.locator('.preview-item .num')).toHaveText('1');
  await expect(page.locator('.preview-item .name')).toHaveText('card-a.png');
  // The thumbnail is an inline data URL, so it can never be revoked out from under us.
  await expect(page.locator('.preview-item img')).toHaveAttribute('src', /^data:image\/jpeg;base64,/);
  await expect(page.locator('#message')).toHaveClass(/hidden/);
  expect(errors).toEqual([]);
});

test('builds a PDF whose page geometry matches the Python original', async ({ page }) => {
  const errors = trackPageErrors(page);
  await page.setInputFiles('#fileInput', [CARD_A, CARD_B]);
  await expect(page.locator('.preview-item')).toHaveCount(2);

  const { bytes, pdf } = await generateAndRead(page);

  expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  expect(pdf.getPageCount()).toBe(2);
  for (const page_ of pdf.getPages()) {
    const { width, height } = page_.getSize();
    expect(width).toBeCloseTo(252, 3);
    expect(height).toBeCloseTo(252, 3);
  }
  expect(errors).toEqual([]);
});

test('places the card at the coordinates fpdf2 emitted, on the Windows target', async ({ page }) => {
  await page.setInputFiles('#fileInput', CARD_A);
  await page.click('#targetBtn');
  await expect(page.locator('#targetBtn')).toHaveText('Target: Windows');
  const { pdf } = await generateAndRead(page);

  // fpdf2 wrote "179.12 0 0 249.73 37.31 2.27 cm" for the 2187x2975 sample card. The
  // height, x and y are fixed; the width follows the cropped aspect ratio, which is
  // 287x412 for this 315x440 fixture (cutoff 13.876 -> round(301)-round(14)).
  const { width, height, x, y, b, c } = imageMatrix(pdf, 0);
  expect(height).toBeCloseTo(249.7275, 2);
  expect(x).toBeCloseTo(37.3120312, 2);
  expect(y).toBeCloseTo(2.2725, 2);
  expect(width).toBeCloseTo(249.7275 * (287 / 412), 2);
  expect(b).toBe(0); // no rotation or skew
  expect(c).toBe(0);
});

test('keeps working when the picked file is gone from disk', async ({ page }) => {
  // The bytes are copied out of the File handle at selection time, so a file that has
  // since been moved or deleted must not break generation.
  const errors = trackPageErrors(page);
  await page.setInputFiles('#fileInput', {
    name: 'vanishing.png',
    mimeType: 'image/png',
    buffer: await readFile(CARD_A),
  });
  await expect(page.locator('.preview-item')).toHaveCount(1);

  // Drop every reference the page could still hold to the original FileList.
  await page.evaluate(() => {
    const input = document.getElementById('fileInput');
    input.value = '';
    return input.files.length;
  });

  const { pdf } = await generateAndRead(page);
  expect(pdf.getPageCount()).toBe(1);
  expect(errors).toEqual([]);
});

test('re-downloads the generated PDF without regenerating it', async ({ page }) => {
  await page.setInputFiles('#fileInput', CARD_A);
  const first = await generateAndRead(page);
  await expect(page.getByRole('button', { name: 'Download PDF' })).toBeEnabled();

  const secondPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF' }).click();
  const second = await secondPromise;
  const secondBytes = await readFile(await second.path());

  // Same blob URL, so the bytes must be byte-identical to the first download.
  expect(secondBytes.equals(first.bytes)).toBe(true);
});

test('reports an unreadable file by name and stays usable', async ({ page }) => {
  await page.setInputFiles('#fileInput', {
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('this is not an image'),
  });

  const message = page.locator('#message');
  await expect(message).toHaveClass(/error/);
  await expect(message).toContainText("Invalid image 'notes.txt'");
  await expect(page.locator('.preview-item')).toHaveCount(0);

  // A valid image afterwards must still work.
  await page.setInputFiles('#fileInput', CARD_A);
  await expect(page.locator('.preview-item')).toHaveCount(1);
});

test('drag and drop reorders the cards and the PDF follows', async ({ page }) => {
  await page.setInputFiles('#fileInput', [CARD_A, CARD_B]);
  const names = page.locator('.preview-item .name');
  await expect(names).toHaveText(['card-a.png', 'card-b.jpg']);

  await page.locator('.preview-item').nth(1).dragTo(page.locator('.preview-item').nth(0));
  await expect(names).toHaveText(['card-b.jpg', 'card-a.png']);
  await expect(page.locator('.preview-item .num')).toHaveText(['1', '2']);

  const { pdf } = await generateAndRead(page);
  expect(pdf.getPageCount()).toBe(2);
});

test('padding and corner radius stop at 0mm', async ({ page }) => {
  await page.setInputFiles('#fileInput', CARD_A);
  for (let i = 0; i < 40; i += 1) {
    await page.click('#paddingMinus');
    await page.click('#cornerMinus');
  }
  await expect(page.locator('#paddingValue')).toHaveText('0.0');
  await expect(page.locator('#cornerValue')).toHaveText('0.0');

  // Zero padding and zero rounding must still produce a valid one-page PDF.
  const { pdf } = await generateAndRead(page);
  expect(pdf.getPageCount()).toBe(1);
});

test('"Generate another" clears the session', async ({ page }) => {
  await page.setInputFiles('#fileInput', CARD_A);
  await generateAndRead(page);

  await page.getByRole('button', { name: 'Generate another' }).click();
  await expect(page.locator('#previewSection')).toBeHidden();
  await expect(page.locator('.preview-item')).toHaveCount(0);
  // The section is hidden now, so query the button by id rather than by role.
  await expect(page.locator('#downloadBtn')).toBeDisabled();
  await expect(page.locator('#paddingValue')).toHaveText('2.8');
});

test('defaults to the Linux target and centres the shrunk card', async ({ page }) => {
  await expect(page.locator('#targetBtn')).toHaveText('Target: Linux');

  await page.setInputFiles('#fileInput', CARD_A);
  const { pdf } = await generateAndRead(page);

  // 88.9mm / (OVERSCAN * 835/818) + 1.1mm tall, width following the cropped image's
  // aspect ratio, card centre 0.3mm right of and 1.6mm above the page centre.
  const PT_PER_MM = 72 / 25.4;
  const { width, height, x, y } = imageMatrix(pdf, 0);
  expect(height / PT_PER_MM).toBeCloseTo(83.7831, 3);
  expect(width / PT_PER_MM).toBeCloseTo(58.8476, 3);
  expect(x / PT_PER_MM).toBeCloseTo(15.3262, 3);
  expect(y / PT_PER_MM).toBeCloseTo(4.1585, 3);
  expect((x + width / 2) / PT_PER_MM).toBeCloseTo(88.9 / 2 + 0.3, 3); // shifted right
  expect((y + height / 2) / PT_PER_MM).toBeCloseTo(88.9 / 2 + 1.6, 3); // lifted centre

  // 1:1 — the drawn rectangle must match the embedded image's aspect ratio exactly,
  // otherwise the card is stretched.
  const [pxW, pxH] = embeddedImageSize(pdf);
  expect(width / height).toBeCloseTo(pxW / pxH, 6);
});

test('the Linux target keeps 0.7mm more black border than Windows', async ({ page }) => {
  // Cropping less leaves a larger source image, which is then stretched into the same
  // fixed rectangle - so the extra black shows up as a border around the artwork.
  await page.setInputFiles('#fileInput', CARD_A);
  const linux = await generateAndRead(page);

  await page.click('#targetBtn');
  const windows = await generateAndRead(page);

  // The embedded pixels must be exactly what cropRect says for each target's padding.
  const expected = (target) => {
    const { sw, sh } = cropRect(315, 440, effectivePaddingMm(target, PADDING_BASE_MM));
    return [sw, sh];
  };
  expect(embeddedImageSize(linux.pdf)).toEqual(expected(TARGET_LINUX));
  expect(embeddedImageSize(windows.pdf)).toEqual(expected(TARGET_WINDOWS));

  const [lw, lh] = embeddedImageSize(linux.pdf);
  const [ww, wh] = embeddedImageSize(windows.pdf);
  expect(lw).toBeGreaterThan(ww);
  expect(lh).toBeGreaterThan(wh);
});

test('the target button toggles back and forth', async ({ page }) => {
  const button = page.locator('#targetBtn');
  await expect(button).toHaveAttribute('data-target', 'linux');
  await expect(button).toHaveAttribute('title', 'Click to switch to Windows');

  await button.click();
  await expect(button).toHaveText('Target: Windows');
  await expect(button).toHaveAttribute('data-target', 'windows');

  await button.click();
  await expect(button).toHaveText('Target: Linux');
  await expect(button).toHaveAttribute('data-target', 'linux');
});

test('switching target invalidates an already generated PDF', async ({ page }) => {
  await page.setInputFiles('#fileInput', CARD_A);
  await generateAndRead(page);
  await expect(page.locator('#downloadBtn')).toBeEnabled();

  // The download would still hold the other layout, so it must not stay available.
  await page.click('#targetBtn');
  await expect(page.locator('#downloadBtn')).toBeDisabled();

  const { pdf } = await generateAndRead(page);
  expect(imageMatrix(pdf, 0).height).toBeCloseTo(249.7275, 2); // now the Windows layout
});

test('the target survives "Generate another"', async ({ page }) => {
  // It is a printer setting, not session data, so a reset must not silently flip it.
  await page.click('#targetBtn');
  await page.setInputFiles('#fileInput', CARD_A);
  await generateAndRead(page);

  await page.getByRole('button', { name: 'Generate another' }).click();
  await expect(page.locator('#targetBtn')).toHaveText('Target: Windows');
  await expect(page.locator('#paddingValue')).toHaveText('2.8');
});

test.describe('print command', () => {
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

  test('is shown at the bottom on Linux and hidden on Windows', async ({ page }) => {
    const section = page.locator('#commandSection');
    await expect(section).toBeVisible();
    await expect(page.locator('#commandText')).toHaveText(LINUX_PRINT_COMMAND);
    await expect(page.locator('#commandHint')).toHaveText('Click to copy');

    await page.click('#targetBtn');
    await expect(section).toBeHidden();

    await page.click('#targetBtn');
    await expect(section).toBeVisible();
  });

  test('a left click puts the command on the clipboard', async ({ page }) => {
    await page.click('#commandBtn');

    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toBe(LINUX_PRINT_COMMAND);
    // The line continuations have to survive, or the paste breaks in a shell.
    expect(clipboard.split('\n')).toHaveLength(6);
    expect(clipboard).toContain('-o PageSize=89x89mm.Borderless');
    expect(clipboard.trimEnd().endsWith(NEWEST_DOWNLOAD)).toBe(true);

    await expect(page.locator('#commandHint')).toHaveText('Copied');
    await expect(page.locator('#commandBtn')).toHaveClass(/copied/);
  });

  test('the feedback reverts so it can be copied again', async ({ page }) => {
    await page.click('#commandBtn');
    await expect(page.locator('#commandHint')).toHaveText('Copied');
    await expect(page.locator('#commandHint')).toHaveText('Click to copy', { timeout: 5000 });
    await expect(page.locator('#commandBtn')).not.toHaveClass(/copied/);
  });

  test('the command\'s glob covers the name the browser actually downloads', async ({ page }) => {
    await page.setInputFiles('#fileInput', CARD_A);
    const { download } = await generateAndRead(page);
    // The browser may append -1, -2, ... on repeat downloads, which the glob absorbs.
    // test/print-command.test.js runs the substitution itself against such names.
    expect(download.suggestedFilename()).toMatch(/^mtg_cards.*\.pdf$/);
    expect(LINUX_PRINT_COMMAND).toContain('mtg_cards*.pdf');
  });
});

test.describe('print alignment offsets', () => {
  const PT_PER_MM = 72 / 25.4;

  const click = async (page, id, times) => {
    for (let i = 0; i < times; i += 1) await page.click(id);
  };

  test('are shown on Linux and hidden on Windows', async ({ page }) => {
    await page.setInputFiles('#fileInput', CARD_A);
    await expect(page.locator('#offsetXRow')).toBeVisible();
    await expect(page.locator('#offsetYRow')).toBeVisible();
    await expect(page.locator('#offsetXValue')).toHaveText('0.3');
    await expect(page.locator('#offsetYValue')).toHaveText('1.6');

    await page.click('#targetBtn');
    await expect(page.locator('#offsetXRow')).toBeHidden();
    await expect(page.locator('#offsetYRow')).toBeHidden();
  });

  test('move the card in the PDF without resizing it', async ({ page }) => {
    await page.setInputFiles('#fileInput', CARD_A);
    const before = imageMatrix((await generateAndRead(page)).pdf, 0);

    await click(page, '#offsetXPlus', 10); // +1.0mm right
    await click(page, '#offsetYMinus', 4); // -0.4mm, i.e. down
    await expect(page.locator('#offsetXValue')).toHaveText('1.3');
    await expect(page.locator('#offsetYValue')).toHaveText('1.2');

    const after = imageMatrix((await generateAndRead(page)).pdf, 0);
    expect((after.x - before.x) / PT_PER_MM).toBeCloseTo(1.0, 3);
    expect((after.y - before.y) / PT_PER_MM).toBeCloseTo(-0.4, 3);
    expect(after.width).toBeCloseTo(before.width, 6);
    expect(after.height).toBeCloseTo(before.height, 6);
  });

  test('nudging invalidates an already generated PDF', async ({ page }) => {
    await page.setInputFiles('#fileInput', CARD_A);
    await generateAndRead(page);
    await expect(page.locator('#downloadBtn')).toBeEnabled();

    await page.click('#offsetXPlus');
    await expect(page.locator('#downloadBtn')).toBeDisabled();
  });

  test('are capped at 10mm', async ({ page }) => {
    await page.setInputFiles('#fileInput', CARD_A);
    // The cap applies to the nudge, so the displayed total is the 0.3mm base plus it.
    await click(page, '#offsetXPlus', 120);
    await expect(page.locator('#offsetXValue')).toHaveText('10.3');
    await click(page, '#offsetXMinus', 240);
    await expect(page.locator('#offsetXValue')).toHaveText('-9.7');
  });

  test('survive "Generate another", unlike padding', async ({ page }) => {
    // They calibrate the printer, not the batch.
    await page.setInputFiles('#fileInput', CARD_A);
    await click(page, '#offsetXPlus', 3);
    await click(page, '#paddingPlus', 3);
    await expect(page.locator('#offsetXValue')).toHaveText('0.6');
    await expect(page.locator('#paddingValue')).toHaveText('3.1');

    await page.getByRole('button', { name: 'Generate another' }).click();
    await expect(page.locator('#offsetXValue')).toHaveText('0.6');
    await expect(page.locator('#paddingValue')).toHaveText('2.8');
  });
});

test.describe('removing cards from the preview', () => {
  const names = (page) => page.locator('.preview-item .name');

  test('drops one card and renumbers the rest', async ({ page }) => {
    await page.setInputFiles('#fileInput', [CARD_A, CARD_B, CARD_A]);
    await expect(page.locator('.preview-item')).toHaveCount(3);

    await page.locator('.preview-item').nth(1).locator('.remove').click();

    await expect(page.locator('.preview-item')).toHaveCount(2);
    await expect(names(page)).toHaveText(['card-a.png', 'card-a.png']);
    await expect(page.locator('.preview-item .num')).toHaveText(['1', '2']);
  });

  test('leaves the remaining cards in the PDF, in order', async ({ page }) => {
    await page.setInputFiles('#fileInput', [CARD_A, CARD_B]);
    await page.locator('.preview-item').first().locator('.remove').click();
    await expect(names(page)).toHaveText(['card-b.jpg']);

    const { pdf } = await generateAndRead(page);
    expect(pdf.getPageCount()).toBe(1);
  });

  test('keeps working after a reorder', async ({ page }) => {
    await page.setInputFiles('#fileInput', [CARD_A, CARD_B]);
    await page.locator('.preview-item').nth(1).dragTo(page.locator('.preview-item').nth(0));
    await expect(names(page)).toHaveText(['card-b.jpg', 'card-a.png']);

    await page.locator('.preview-item').first().locator('.remove').click();
    await expect(names(page)).toHaveText(['card-a.png']);
    expect((await generateAndRead(page)).pdf.getPageCount()).toBe(1);
  });

  test('hides the preview once the last card is gone', async ({ page }) => {
    await page.setInputFiles('#fileInput', CARD_A);
    await page.locator('.preview-item').first().locator('.remove').click();

    await expect(page.locator('#previewSection')).toBeHidden();
    await expect(page.locator('.preview-item')).toHaveCount(0);

    // Adding a file afterwards must bring the list back.
    await page.setInputFiles('#fileInput', CARD_B);
    await expect(page.locator('.preview-item')).toHaveCount(1);
    await expect(names(page)).toHaveText(['card-b.jpg']);
  });

  test('does not open the lightbox', async ({ page }) => {
    await page.setInputFiles('#fileInput', [CARD_A, CARD_B]);
    await page.locator('.preview-item').first().locator('.remove').click();
    await expect(page.locator('#lightbox')).not.toHaveClass(/show/);
  });

  test('invalidates an already generated PDF', async ({ page }) => {
    await page.setInputFiles('#fileInput', [CARD_A, CARD_B]);
    await generateAndRead(page);
    await expect(page.locator('#downloadBtn')).toBeEnabled();

    await page.locator('.preview-item').first().locator('.remove').click();
    await expect(page.locator('#downloadBtn')).toBeDisabled();

    expect((await generateAndRead(page)).pdf.getPageCount()).toBe(1);
  });

  test('frees the slot against the image limit', async ({ page }) => {
    await page.setInputFiles('#fileInput', [CARD_A, CARD_B]);
    await page.locator('.preview-item').first().locator('.remove').click();
    // The removed card must not keep counting towards MAX_IMAGES / the byte budget.
    await page.setInputFiles('#fileInput', CARD_A);
    await expect(page.locator('.preview-item')).toHaveCount(2);
    await expect(page.locator('#message')).toHaveClass(/hidden/);
  });
});

test('renders a filename containing quotes literally', async ({ page }) => {
  // Filenames come off the user's disk; they must never be parsed as markup.
  const hostile = 'a" onmouseover="document.title=\'pwned\'" b.png';
  await page.setInputFiles('#fileInput', {
    name: hostile,
    mimeType: 'image/png',
    buffer: await readFile(CARD_A),
  });

  const name = page.locator('.preview-item .name');
  await expect(name).toHaveText(hostile);
  // The whole filename must survive inside the attribute, not just the part before
  // the first quote, and no part of it may become an event handler.
  await expect(name).toHaveAttribute('title', hostile);
  await name.hover();
  expect(await page.title()).toBe('MTG Card PDF');
});
