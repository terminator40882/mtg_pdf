/**
 * The preview grid and its drag-to-reorder behaviour.
 * Owns no application state: it renders whatever items/order it is handed and
 * reports a requested new order back through onReorder.
 */
import { reorder } from './geometry.js';

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

/**
 * @param {HTMLElement} grid container element
 * @param {{onReorder: (order: number[]) => void, onZoom: (item: object) => void}} handlers
 */
export function createPreviewGrid(grid, { onReorder, onZoom }) {
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

  function render(items, nextOrder) {
    order = nextOrder;
    grid.innerHTML = '';
    order.forEach((idx, position) => {
      const item = items[idx];
      if (!item) return;
      const div = document.createElement('div');
      div.className = 'preview-item';
      div.draggable = true;
      div.dataset.index = String(position);
      div.innerHTML =
        '<span class="num">' + (position + 1) + '</span>' +
        '<div class="thumb-wrap"><img src="' + item.dataUrl + '" alt=""></div>' +
        '<div class="name" title="' + escapeHtml(item.filename) + '">' +
        escapeHtml(item.filename) + '</div>';
      div.addEventListener('click', (e) => {
        if (e.target.closest('.thumb-wrap')) onZoom(item);
      });
      div.addEventListener('dragstart', onDragStart);
      div.addEventListener('dragover', onDragOver);
      div.addEventListener('drop', onDrop);
      div.addEventListener('dragend', onDragEnd);
      grid.appendChild(div);
    });
  }

  function clear() {
    grid.innerHTML = '';
    order = [];
  }

  return { render, clear };
}
