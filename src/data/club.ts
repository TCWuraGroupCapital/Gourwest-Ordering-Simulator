/** Gourwest Club tiers. Thresholds mirror Luminara CRM (packages/Webkul/Gourwest/src/Config/gourwest.php). */
export const TIERS = [
  { name: 'Bronze', from: 0, perks: ['Points on every order', 'Member-only seasonal previews'] },
  { name: 'Silver', from: 750, perks: ['Free side on your birthday', 'Early access to new dishes'] },
  { name: 'Gold', from: 2000, perks: ['Free bowl every 1,000 points', 'Priority pickup shelf'] },
  { name: 'Platinum', from: 5000, perks: ['Chef’s table tastings', 'Free catering delivery'] },
] as const;

export function tierFor(points: number): (typeof TIERS)[number] {
  return [...TIERS].reverse().find((t) => points >= t.from) ?? TIERS[0];
}

/** A balance's tier, the next tier up (null at the top) and the points still needed to reach it. */
export function tierProgress(points: number) {
  const tier = tierFor(points);
  const next: (typeof TIERS)[number] | null = TIERS[TIERS.indexOf(tier) + 1] ?? null;
  return { tier, next, toNext: next ? next.from - points : 0 };
}
