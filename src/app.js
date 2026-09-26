/**
 * UI wiring for the client-side MTG card PDF generator.
 *
 * Replaces the /upload, /generate, /download and /reset endpoints of the former
 * Flask app; everything now happens in this tab. State lives only in memory, so a
 * reload starts empty exactly as it did when index() cleared the server store.
 */
import {
  CORNER_RADIUS_BASE_MM,
  DEFAULT_TARGET,
  PADDING_BASE_MM,
  TARGET_LINUX,
  TARGET_WINDOWS,
  clampCornerDelta,
  clampPaddingDelta,
  limitError,
} from './geometry.js';
import { makeThumbnailDataUrl } from './thumbnail.js';
import { buildPdf } from './pdf-build.js';
import { createPreviewGrid } from './preview.js';
import { LINUX_PRINT_COMMAND } from './print-command.js';
import { createCopyButton } from './copy-button.js';

/** @type {{filename: string, blob: Blob, size: number, dataUrl: string}[]} */
const items = [];
let order = [];
let paddingDelta = 0;
let cornerDelta = 0;
let target = DEFAULT_TARGET;
/** The single live object URL for the generated PDF, or null. */
let pdfUrl = null;

const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const messageEl = document.getElementById('message');
const previewSection = document.getElementById('previewSection');
const paddingValue = document.getElementById('paddingValue');
const cornerValue = document.getElementById('cornerValue');
const generateBtn = document.getElementById('generateBtn');
const downloadBtn = document.getElementById('downloadBtn');
const resetBtn = document.getElementById('resetBtn');
const targetBtn = document.getElementById('targetBtn');
const commandSection = document.getElementById('commandSection');
const commandBtn = document.getElementById('commandBtn');
const commandHint = document.getElementById('commandHint');
const downloadLink = document.getElementById('downloadLink');
const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightboxImg');

/** Reused for thumbnail rendering so we never keep more than one scratch canvas. */
const thumbCanvas = document.createElement('canvas');

const preview = createPreviewGrid(document.getElementById('previewGrid'), {
  onReorder: (next) => {
    order = next;
    preview.render(items, order);
  },
  onZoom: (item) => {
    lightboxImg.src = item.dataUrl;
    lightbox.classList.add('show');
  },
});

function showMessage(text, type) {
  messageEl.textContent = text;
  messageEl.className = 'message ' + (type || '');
  messageEl.classList.remove('hidden');
}
function hideMessage() {
  messageEl.classList.add('hidden');
}

// --- Padding / corner controls ---

function updateControlLabels() {
  paddingValue.textContent = (PADDING_BASE_MM + paddingDelta).toFixed(1);
  cornerValue.textContent = (CORNER_RADIUS_BASE_MM + cornerDelta).toFixed(1);
}
document.getElementById('paddingMinus').addEventListener('click', () => {
  paddingDelta = clampPaddingDelta(paddingDelta - 0.1);
  updateControlLabels();
});
document.getElementById('paddingPlus').addEventListener('click', () => {
  paddingDelta += 0.1;
  updateControlLabels();
});
document.getElementById('cornerMinus').addEventListener('click', () => {
  cornerDelta = clampCornerDelta(cornerDelta - 0.1);
  updateControlLabels();
});
document.getElementById('cornerPlus').addEventListener('click', () => {
  cornerDelta += 0.1;
  updateControlLabels();
});

// --- Output target ---

const TARGET_LABELS = { [TARGET_LINUX]: 'Linux', [TARGET_WINDOWS]: 'Windows' };

function updateTargetButton() {
  const other = target === TARGET_LINUX ? TARGET_WINDOWS : TARGET_LINUX;
  targetBtn.textContent = `Target: ${TARGET_LABELS[target]}`;
  targetBtn.title = `Click to switch to ${TARGET_LABELS[other]}`;
  targetBtn.dataset.target = target;
  // The print command is specific to the borderless Linux setup.
  commandSection.hidden = target !== TARGET_LINUX;
}
targetBtn.addEventListener('click', () => {
  target = target === TARGET_LINUX ? TARGET_WINDOWS : TARGET_LINUX;
  updateTargetButton();
  // Any PDF already generated used the other layout, so it must not stay downloadable.
  releasePdf();
});

// --- Print command (click to copy) ---

createCopyButton(
  commandBtn,
  document.getElementById('commandText'),
  commandHint,
  LINUX_PRINT_COMMAND,
);

document.getElementById('lightboxClose').addEventListener('click', () => lightbox.classList.remove('show'));
lightbox.addEventListener('click', function (e) {
  if (e.target === this) this.classList.remove('show');
});

// --- Adding files (replaces POST /upload) ---

async function addFiles(files) {
  const selected = files.filter((f) => f && f.name);
  if (!selected.length) return;
  hideMessage();

  const rejected = limitError(
    items.length,
    items.reduce((sum, i) => sum + i.size, 0),
    selected.length,
    selected.reduce((sum, f) => sum + f.size, 0),
  );
  if (rejected) {
    showMessage(rejected, 'error');
    return;
  }

  let failure = null;
  for (const file of selected) {
    try {
      // Copy the bytes out of the file handle right now. A File is only a pointer to
      // disk: reading it later fails once the user moves, renames or deletes it, and
      // generating a PDF can happen minutes after picking the images.
      const buffer = await file.arrayBuffer();
      if (!buffer.byteLength) {
        failure = `Empty file: ${file.name}`;
        break;
      }
      const blob = new Blob([buffer], { type: file.type || 'application/octet-stream' });
      let bitmap = null;
      let dataUrl;
      try {
        bitmap = await createImageBitmap(blob); // doubles as the validity check
        dataUrl = makeThumbnailDataUrl(bitmap, thumbCanvas);
      } finally {
        bitmap?.close();
      }
      items.push({ filename: file.name, blob, size: buffer.byteLength, dataUrl });
      order.push(items.length - 1);
    } catch (err) {
      failure = `Invalid image '${file.name}': ${err.message}`;
      break;
    }
  }

  if (items.length) {
    previewSection.style.display = 'block';
    preview.render(items, order);
    updateControlLabels();
  }
  if (failure) showMessage(failure, 'error');
}

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('dragover');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  addFiles(Array.from(e.dataTransfer.files));
});
fileInput.addEventListener('change', () => {
  addFiles(Array.from(fileInput.files));
  fileInput.value = '';
});

// --- Generating & downloading (replaces POST /generate and GET /download) ---

function releasePdf() {
  if (pdfUrl) {
    URL.revokeObjectURL(pdfUrl);
    pdfUrl = null;
  }
  downloadBtn.disabled = true;
}
function triggerDownload() {
  downloadLink.href = pdfUrl;
  downloadLink.download = 'mtg_cards.pdf';
  downloadLink.click();
}

generateBtn.addEventListener('click', async () => {
  if (!items.length) return;
  hideMessage();
  generateBtn.disabled = true;
  // Revoke the previous URL here rather than after the click that used it: revoking
  // straight after .click() aborts the download that is still starting.
  releasePdf();

  generateBtn.textContent = `Generating… 0/${order.length}`;
  try {
    const { blob, downscaled } = await buildPdf(
      items,
      order,
      {
        paddingMm: PADDING_BASE_MM + paddingDelta,
        cornerMm: CORNER_RADIUS_BASE_MM + cornerDelta,
        target,
      },
      (done, count) => {
        generateBtn.textContent = `Generating… ${done}/${count}`;
      },
    );
    pdfUrl = URL.createObjectURL(blob);
    downloadBtn.disabled = false;
    triggerDownload();
    if (downscaled) {
      showMessage(`${downscaled} image(s) were downscaled to fit the browser's canvas limit`, 'success');
    }
  } catch (err) {
    showMessage(err.message || 'Generate failed', 'error');
  } finally {
    generateBtn.disabled = false;
    generateBtn.textContent = 'Generate PDF';
  }
});

downloadBtn.addEventListener('click', () => {
  if (pdfUrl) triggerDownload();
});

// --- Reset (replaces POST /reset) ---

resetBtn.addEventListener('click', () => {
  releasePdf();
  items.length = 0;
  order = [];
  paddingDelta = 0;
  cornerDelta = 0;
  previewSection.style.display = 'none';
  preview.clear();
  updateControlLabels();
  hideMessage();
});

updateControlLabels();
updateTargetButton();
