import { describe, expect, it } from 'vitest';
import { STAGES, trackOrder } from '../src/lib/tracking';

const placed = '2026-11-18T01:00:00.000Z';
const at = (minutes: number) => Date.parse(placed) + minutes * 60_000;

describe('trackOrder', () => {
  it('starts at "sent" with the full prep time left', () => {
    const t = trackOrder(placed, 15, at(0))!;
    expect(STAGES[t.stage].id).toBe('sent');
    expect(t.minutesLeft).toBe(15);
    expect(t.readyAt.toISOString()).toBe('2026-11-18T01:15:00.000Z');
  });

  it('moves through cooking and packing to ready on the prep clock', () => {
    expect(STAGES[trackOrder(placed, 15, at(3))!.stage].id).toBe('cooking');
    expect(STAGES[trackOrder(placed, 15, at(12))!.stage].id).toBe('packing');
    const ready = trackOrder(placed, 15, at(15))!;
    expect(STAGES[ready.stage].id).toBe('ready');
    expect(ready.ready).toBe(true);
    expect(trackOrder(placed, 15, at(14.9))!.ready).toBe(false);
    expect(ready.minutesLeft).toBe(0);
    expect(ready.progress).toBe(1);
  });

  it('rounds minutes left up so it never says 0 before ready', () => {
    expect(trackOrder(placed, 15, at(14.9))!.minutesLeft).toBe(1);
  });

  it('stays active until 45 minutes after ready', () => {
    expect(trackOrder(placed, 15, at(59))!.active).toBe(true);
    expect(trackOrder(placed, 15, at(61))!.active).toBe(false);
  });

  it('treats a clock behind the order time as just placed', () => {
    expect(trackOrder(placed, 15, at(-5))!.stage).toBe(0);
  });

  it('rejects unreadable orders', () => {
    expect(trackOrder('not a date', 15)).toBeNull();
    expect(trackOrder(placed, 0)).toBeNull();
  });
});
