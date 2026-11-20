/** Wires every `[data-quick-add]` button (sides and drinks without options) to the bag. */
import { findItem } from '../data/menu';
import { defaultChoices } from '../lib/pricing';
import { addToCart } from './state';
import { toast } from './toast';

document.addEventListener('click', (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>('[data-quick-add]');
  if (!button) return;
  const item = findItem(button.dataset.quickAdd!);
  if (!item) return;
  addToCart({ slug: item.slug, qty: 1, choices: defaultChoices(item) });
  toast(`${item.name} added to your bag`);
});
