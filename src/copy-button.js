/**
 * Click-to-copy block with transient feedback.
 * Kept separate from app.js so the clipboard fallback does not clutter the UI wiring.
 */

const IDLE_LABEL = 'Click to copy';
const FEEDBACK_MS = 2000;

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // navigator.clipboard needs a secure context; fall back to the old selection trick.
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    let copied = false;
    try {
      copied = document.execCommand('copy');
    } catch {
      copied = false;
    }
    area.remove();
    return copied;
  }
}

/**
 * @param {HTMLElement} button the clickable block
 * @param {HTMLElement} output element that renders the text
 * @param {HTMLElement} hint element that shows "Click to copy" / "Copied"
 * @param {string} text what a click puts on the clipboard
 */
export function createCopyButton(button, output, hint, text) {
  output.textContent = text;
  hint.textContent = IDLE_LABEL;

  let timer = null;
  button.addEventListener('click', async () => {
    const copied = await copyText(text);
    hint.textContent = copied ? 'Copied' : 'Copy failed — select it manually';
    button.classList.toggle('copied', copied);
    clearTimeout(timer);
    timer = setTimeout(() => {
      hint.textContent = IDLE_LABEL;
      button.classList.remove('copied');
    }, FEEDBACK_MS);
  });
}
