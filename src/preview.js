/**
 * The preview grid: thumbnails, drag-to-reorder, and a remove button per card.
 * Owns no application state - it renders whatever items/order it is handed and
 * reports requested changes back through the handlers.
 *
 * The nodes are built with DOM calls rather than innerHTML: filenames come from the
 * user's disk and may contain quotes, which would break out of an HTML attribute.
 */
import { reorder } from './geometry.js';

/**
 * @param {HTMLElement} grid container element
 * @param {{onReorder: (order: number[]) => void, onRemove: (id: number) => void,
 *          onZoom: (item: object) => void}} handlers
 */
export function createPreviewGrid(grid, { onReorder, onRemove, onZoom }) {
  let draggedIndex = null;
  let order = [];

  function onDragStart(e) {
    draggedIndex = parseInt(e.currentTarget.dataset.index, 10);
    e.currentTarget.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(draggedIndex));
  }
  function onDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }
  function onDrop(e) {
    e.preventDefault();
    const toIndex = parseInt(e.currentTarget.dataset.index, 10);
    if (draggedIndex === null || draggedIndex === toIndex) return;
    onReorder(reorder(order, draggedIndex, toIndex));
  }
  function onDragEnd(e) {
    e.currentTarget.classList.remove('dragging');
    draggedIndex = null;
  }

  function buildItem(item, id, position) {
    const div = document.createElement('div');
    div.className = 'preview-item';
    div.draggable = true;
    div.dataset.index = String(position);
    div.dataset.id = String(id);

    const num = document.createElement('span');
    num.className = 'num';
    num.textContent = String(position + 1);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'remove';
    remove.draggable = false; // otherwise dragging the button starts a card drag
    remove.textContent = '×';
    remove.title = 'Remove';
    remove.setAttribute('aria-label', `Remove ${item.filename}`);
    remove.addEventListener('click', (e) => {
      e.stopPropagation(); // do not open the lightbox as well
      onRemove(id);
    });

    const wrap = document.createElement('div');
    wrap.className = 'thumb-wrap';
    const img = document.createElement('img');
    img.src = item.dataUrl;
    img.alt = '';
    wrap.appendChild(img);

    const name = document.createElement('div');
    name.className = 'name';
    name.title = item.filename;
    name.textContent = item.filename;

    div.append(num, remove, wrap, name);
    div.addEventListener('click', (e) => {
      if (e.target.closest('.thumb-wrap')) onZoom(item);
    });
    div.addEventListener('dragstart', onDragStart);
    div.addEventListener('dragover', onDragOver);
    div.addEventListener('drop', onDrop);
    div.addEventListener('dragend', onDragEnd);
    return div;
  }

  function render(items, nextOrder) {
    order = nextOrder;
    grid.innerHTML = '';
    order.forEach((id, position) => {
      const item = items[id];
      if (item) grid.appendChild(buildItem(item, id, position));
    });
  }

  function clear() {
    grid.innerHTML = '';
    order = [];
  }

  return { render, clear };
}
