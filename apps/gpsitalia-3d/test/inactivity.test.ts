import { describe, expect, it } from 'vitest';
import { createInactivityWatch } from '../src/inactivity';

function harness(idleMs = 10_000, countdownMs = 3_000) {
  let clock = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  let next = 1;
  const events: string[] = [];
  const watch = createInactivityWatch({
    idleMs, countdownMs,
    onWarn: s => events.push(`warn:${s}`), onTick: s => events.push(`tick:${s}`),
    onResume: () => events.push('resume'), onExpire: () => events.push('expire'),
    now: () => clock,
    setTimer: (callback, ms) => { const id = next++; timers.set(id, { at: clock + ms, callback }); return id; },
    clearTimer: id => { timers.delete(id as number); },
  });
  const advance = (ms: number) => {
    const end = clock + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]); clock = due[1].at; due[1].callback();
    }
    clock = end;
  };
  const jump = (ms: number) => { clock += ms; }; // time passes without timers firing (hidden tab)
  return { watch, events, advance, jump };
}

describe('createInactivityWatch', () => {
  it('warns after the idle time, counts down, then expires', () => {
    const h = harness();
    h.advance(9_999); expect(h.events).toEqual([]);
    h.advance(1); expect(h.events).toEqual(['warn:3']);
    h.advance(3_000); expect(h.events).toEqual(['warn:3', 'tick:2', 'tick:1', 'expire']);
  });
  it('activity before the warning postpones it', () => {
    const h = harness();
    h.advance(8_000); h.watch.activity(); h.advance(8_000);
    expect(h.events).toEqual([]);
    h.advance(2_000); expect(h.events).toEqual(['warn:3']);
  });
  it('plain activity does not dismiss the warning; only confirm does', () => {
    const h = harness();
    h.advance(10_000); h.watch.activity(); h.advance(1_000);
    expect(h.watch.warning).toBe(true);
    h.watch.confirm(); expect(h.events).toContain('resume'); expect(h.watch.warning).toBe(false);
    h.advance(9_999); expect(h.events.filter(e => e.startsWith('warn'))).toHaveLength(1);
    h.advance(1); expect(h.events.filter(e => e.startsWith('warn'))).toHaveLength(2);
  });
  it('expires at once when coming back to a hidden tab after the deadline', () => {
    const h = harness();
    h.jump(60_000); h.watch.check();
    expect(h.events).toEqual(['expire']);
  });
  it('stop() cancels everything', () => {
    const h = harness();
    h.watch.stop(); h.advance(100_000);
    expect(h.events).toEqual([]);
  });
  it('expires only once', () => {
    const h = harness();
    h.advance(20_000); h.watch.check(); h.watch.confirm();
    expect(h.events.filter(e => e === 'expire')).toHaveLength(1);
  });
});
