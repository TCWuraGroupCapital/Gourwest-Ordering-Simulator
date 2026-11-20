/**
 * Site-wide kitchen controls, loaded once by the base layout:
 * - `[data-pick-store="<id>"]` buttons choose that kitchen and open the menu;
 * - `[data-open-badge="<id>"]` elements show whether the kitchen is open in its local time.
 */
import { STORES, isOpen } from '../data/stores';
import { setStore } from './state';

for (const badge of document.querySelectorAll<HTMLElement>('[data-open-badge]')) {
  const store = STORES.find((s) => s.id === badge.dataset.openBadge);
  if (!store) continue;
  const open = isOpen(store);
  badge.textContent = open ? 'Open now' : 'Closed now';
  badge.dataset.state = open ? 'open' : 'closed';
}

document.addEventListener('click', (event) => {
  const button = (event.target as Element).closest<HTMLElement>('[data-pick-store]');
  if (!button) return;
  setStore(button.dataset.pickStore!);
  location.href = '/menu/';
});
