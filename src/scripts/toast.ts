let timer: number | undefined;
/** Announces a short confirmation in the shared polite live region. */
export function toast(message: string): void {
  const el = document.querySelector<HTMLElement>('[data-toast]');
  if (!el) return;
  el.textContent = message;
  el.classList.add('is-on');
  window.clearTimeout(timer);
  timer = window.setTimeout(() => el.classList.remove('is-on'), 2600);
}

const FLASH_KEY = 'gourwest:flash';

/** A toast for the next page shown in this tab (e.g. "added to your bag" after returning to the menu). */
export function flash(message: string): void {
  try {
    sessionStorage.setItem(FLASH_KEY, message);
  } catch {
    /* Storage blocked: the bag still updates, only the confirmation is lost. */
  }
}

// pageshow also fires when the browser restores a page from the back/forward cache.
window.addEventListener('pageshow', () => {
  let message: string | null = null;
  try {
    message = sessionStorage.getItem(FLASH_KEY);
    sessionStorage.removeItem(FLASH_KEY);
  } catch {}
  if (message) toast(message);
});
