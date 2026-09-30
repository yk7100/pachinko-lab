import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults, presets, clone, validate, Machine, theoretical, seeded, runSession } from '../engine.js';
const sequence = (...values) => { let i = 0; return () => values[i++] ?? .9; };
test('invalid probabilities, empty fields and malformed distributions are rejected', () => {
  assert.equal(validate(defaults).length, 0);
  assert.ok(validate({ ...defaults, normalOdds: 1, chargeOdds: 2 }).length);
  assert.ok(validate({ ...defaults, rightOdds: NaN }).length);
  assert.ok(validate({ ...defaults, rightRows: [{ balls: 1500, weight: 99, keep: true }] }).length);
  assert.ok(validate({ ...defaults, rightRows: [{ balls: -1, weight: 100, keep: 'false' }] }).length);
});
test('initial payout and entry, ST reset and terminal outcome update correctly', () => {
  const c = { ...defaults, normalOdds: 1, entryRate: 100, rightOdds: 1, stSpins: 10, residual: 4, rightRows: [{ balls: 1500, weight: 50, keep: true }, { balls: 3000, weight: 50, keep: false }] };
  const m = new Machine(c, sequence(0, 0, 0, 0, .1, 0, .9));
  m.step(); assert.equal(m.s.mode, 'st'); assert.equal(m.s.paid, 450); assert.equal(m.s.remaining, 14);
  m.step(); assert.equal(m.s.paid, 1950); assert.equal(m.s.remaining, 14); assert.equal(m.s.chain, 2);
  m.step(); assert.equal(m.s.mode, 'normal'); assert.equal(m.s.paid, 4950); assert.equal(m.s.chain, 3);
});
test('ST expires after exactly ST plus residual spins', () => {
  const m = new Machine({ ...defaults, stSpins: 2, residual: 1 }, () => .99);
  m.enter(); m.step(); m.step(); assert.equal(m.s.mode, 'st'); m.step(); assert.equal(m.s.mode, 'normal'); assert.equal(m.s.rightSpins, 3);
});
test('fall is drawn only after a missed jackpot', () => {
  const m = new Machine({ ...presets.fall, rightOdds: 2, fallOdds: 1 }, sequence(0, 0, .99, 0));
  m.enter(); assert.equal(m.step().kind, 'hit'); assert.equal(m.s.mode, 'fall'); assert.equal(m.step().kind, 'exit'); assert.equal(m.s.mode, 'normal');
});
test('small hits award balls without counting as jackpots or resetting chain', () => {
  const m = new Machine(presets.small, sequence(.99, 0)); m.enter();
  assert.equal(m.step().kind, 'small'); assert.equal(m.s.paid, 12); assert.equal(m.s.hits, 0); assert.equal(m.s.smallHits, 1); assert.equal(m.net, 11.5);
});
test('charge is exclusive of jackpot and supports independent entry', () => {
  const m = new Machine({ ...defaults, normalOdds: 10, chargeOdds: 2, chargeEntry: 100 }, sequence(.2, 0));
  m.step(); assert.equal(m.s.hits, 0); assert.equal(m.s.charges, 1); assert.equal(m.s.paid, 300); assert.equal(m.s.mode, 'st');
});
test('batch stops at normal limit, at first non-entry jackpot, or after a rush', () => {
  const miss = runSession(defaults, 100, () => .99); assert.equal(miss.spins, 100); assert.equal(miss.initial, 0);
  const hit = runSession({ ...defaults, normalOdds: 1, entryRate: 0 }, 100, () => .5); assert.equal(hit.spins, 1); assert.equal(hit.initial, 1);
  const capped = runSession({ ...presets.small, normalOdds: 1, entryRate: 100, rightRows: [{ balls: 1000, weight: 100, keep: true }] }, 100, () => 0, 10); assert.equal(capped.limited, true); assert.equal(capped.spins, 11);
});
test('seeded simulation is reproducible and ST hit rate agrees with theory', () => {
  const c = clone(defaults), rng = seeded(777); let hits = 0, count = 20000;
  const expected = theoretical(c).hit;
  for (let i = 0; i < count; i++) { const m = new Machine(c, rng, false); m.enter(); for (let n = 0; n < c.stSpins + c.residual; n++) { if (m.step().kind === 'hit') { hits++; break; } } }
  assert.ok(Math.abs(hits / count - expected) < .015);
  assert.deepEqual(runSession(c, 1000, seeded(777)), runSession(c, 1000, seeded(777)));
});
test('fall hit rate and terminal payout weights produce expected continuation', () => {
  const c = { ...presets.fall, rightOdds: 10, fallOdds: 10, rightRows: [{ balls: 1500, weight: 50, keep: true }, { balls: 300, weight: 50, keep: false }] };
  assert.ok(Math.abs(theoretical(c).cycle - .1 / (.1 + .9 * .1) * .5) < 1e-12);
  const rng = seeded(13); let hits = 0;
  for (let i = 0; i < 20000; i++) { const m = new Machine(c, rng, false); m.enter(); while (m.s.mode !== 'normal') { const e = m.step(); if (e.kind === 'hit') { hits++; break; } } }
  assert.ok(Math.abs(hits / 20000 - theoretical(c).hit) < .015);
});
