/**
 * Pickup tracking. Luminara CRM confirms the order but reports no kitchen status, so the later
 * stages are estimated from when the order was placed and the kitchen's usual prep time.
 * The UI says so; nothing here pretends to be a live feed.
 */

export const STAGES = [
  { id: 'sent', title: 'Sent to the kitchen', at: 0 },
  { id: 'cooking', title: 'On the grill', at: 0.15 },
  { id: 'packing', title: 'Packing your order', at: 0.8 },
  { id: 'ready', title: 'Ready at the pass', at: 1 },
] as const;

/** After this long past ready time the order counts as collected and stops showing in the header. */
const SHOW_AFTER_READY_MS = 45 * 60_000;

export interface Tracking {
  /** Index into STAGES of the stage reached. */
  stage: number;
  ready: boolean;
  /** 0–1 share of the prep time elapsed. */
  progress: number;
  readyAt: Date;
  /** Whole minutes until ready, rounded up; 0 once ready. */
  minutesLeft: number;
  /** False once the order is long past ready (probably collected). */
  active: boolean;
}

export function trackOrder(placedAt: string, prepMinutes: number, now = Date.now()): Tracking | null {
  const start = Date.parse(placedAt);
  if (!Number.isFinite(start) || !(prepMinutes > 0)) return null;
  const total = prepMinutes * 60_000;
  const elapsed = Math.max(0, now - start);
  const progress = Math.min(1, elapsed / total);
  return {
    stage: STAGES.findLastIndex((s) => progress >= s.at),
    ready: progress === 1,
    progress,
    readyAt: new Date(start + total),
    minutesLeft: Math.max(0, Math.ceil((total - elapsed) / 60_000)),
    active: elapsed < total + SHOW_AFTER_READY_MS,
  };
}
