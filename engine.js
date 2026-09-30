export const defaults = {
  name: 'カスタム ST', type: 'st', normalOdds: 319.7, chargeOdds: 0, entryRate: 60,
  chargeBalls: 300, chargeEntry: 0, spinsPer250: 18, rightCost: 0.5,
  stSpins: 163, residual: 4, rightOdds: 99.9, fallOdds: 150,
  smallOdds: 1.5, smallBalls: 12,
  normalRows: [{ balls: 450, weight: 100 }],
  rightRows: [{ balls: 1500, weight: 80, keep: true }, { balls: 3000, weight: 20, keep: true }]
};
export const presets = {
  st: { ...defaults },
  fall: { ...defaults, name: 'カスタム 転落', type: 'fall', rightOdds: 45, fallOdds: 150, residual: 0, rightRows: [{ balls: 1500, weight: 100, keep: true }] },
  small: { ...defaults, name: 'カスタム 小当たりRUSH', type: 'small', rightOdds: 80, smallOdds: 1.5, smallBalls: 12, residual: 0, rightRows: [{ balls: 1000, weight: 70, keep: true }, { balls: 1000, weight: 30, keep: false }] }
};
export const clone = value => JSON.parse(JSON.stringify(value));
export function validate(c) {
  const errors = [];
  if (!['st', 'fall', 'small'].includes(c.type)) errors.push('右打ちタイプが不正です。');
  const range = (key, label, min, max, integer = false) => {
    if (!Number.isFinite(c[key]) || c[key] < min || c[key] > max || (integer && !Number.isInteger(c[key]))) errors.push(`${label}は${min}〜${max}${integer ? 'の整数' : ''}で入力してください。`);
  };
  range('normalOdds', '通常時の大当たり分母', 1, 1000000);
  range('chargeOdds', 'チャージ分母（0で無効）', 0, 1000000);
  if (c.chargeOdds > 0 && c.chargeOdds < 1) errors.push('チャージ分母は1以上、または0にしてください。');
  if (1 / c.normalOdds + (c.chargeOdds ? 1 / c.chargeOdds : 0) > 1 + 1e-12) errors.push('大当たりとチャージの確率の合計は100%以下にしてください。');
  range('entryRate', '右打ち突入率', 0, 100); range('chargeEntry', 'チャージからの突入率', 0, 100);
  range('chargeBalls', 'チャージ出玉', 0, 100000, true); range('spinsPer250', '250玉あたりの回転数', 0.1, 1000);
  range('rightCost', '右打ち1回転の消費玉', 0, 100); range('rightOdds', '右打ちの大当たり分母', 1, 1000000);
  range('stSpins', 'ST回転数', 1, 10000, true); range('residual', '残保留', 0, 100, true);
  range('fallOdds', '転落分母', 1, 1000000); range('smallOdds', '小当たり分母', 1, 1000000); range('smallBalls', '小当たり出玉', 0, 100000, true);
  for (const [key, label] of [['normalRows', '初当たり'], ['rightRows', '右打ち']]) {
    const rows = c[key];
    if (!Array.isArray(rows) || !rows.length || rows.length > 20) { errors.push(`${label}の振り分けは1〜20行にしてください。`); continue; }
    if (rows.some(r => !Number.isFinite(r.weight) || r.weight < 0 || r.weight > 100 || !Number.isInteger(r.balls) || r.balls < 0 || r.balls > 100000 || (key === 'rightRows' && typeof r.keep !== 'boolean'))) errors.push(`${label}の振り分けの出玉・割合・継続設定を確認してください。`);
    if (Math.abs(rows.reduce((sum, r) => sum + r.weight, 0) - 100) > 0.0001) errors.push(`${label}の振り分けの合計を100%にしてください。`);
  }
  return errors;
}
function pick(rows, rng) {
  const n = rng() * 100; let sum = 0;
  for (const row of rows) { sum += row.weight; if (n < sum) return row; }
  return rows[rows.length - 1];
}
export function seeded(seed) {
  let a = seed >>> 0;
  return () => { a += 0x6D2B79F5; let t = a; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export function theoretical(c) {
  const keep = c.rightRows.reduce((s, r) => s + (r.keep ? r.weight : 0), 0) / 100;
  const hit = c.type === 'st' ? -Math.expm1((c.stSpins + c.residual) * Math.log1p(-1 / c.rightOdds))
    : c.type === 'fall' ? (1 / c.rightOdds) / (1 / c.rightOdds + (1 - 1 / c.rightOdds) / c.fallOdds) : 1;
  const cycle = hit * keep;
  return { hit, cycle, meanRightHits: cycle === 1 ? Infinity : hit / (1 - cycle) };
}
export class Machine {
  constructor(config, rng = Math.random, record = true) {
    const errors = validate(config); if (errors.length) throw new Error(errors.join('\n'));
    this.c = clone(config); this.rng = rng; this.record = record;
    this.s = { mode: 'normal', spins: 0, leftSpins: 0, rightSpins: 0, sinceHit: 0, remaining: 0, hits: 0, initialHits: 0, charges: 0, smallHits: 0, entries: 0, chain: 0, maxChain: 0, rushBalls: 0, paid: 0, used: 0, last: '開始待ち', events: [], points: [{ spin: 0, net: 0 }] };
  }
  get net() { return this.s.paid - this.s.used; }
  log(kind, text, balls = 0) {
    if (kind !== 'miss') this.s.last = text;
    if (this.record && kind !== 'miss') { this.s.events.unshift({ spin: this.s.spins, kind, text, balls, net: this.net }); this.s.events.length = Math.min(200, this.s.events.length); }
    return { kind, text, balls };
  }
  enter() { this.s.mode = this.c.type; this.s.entries++; this.s.remaining = this.c.stSpins + this.c.residual; }
  exit(reason) { this.s.mode = 'normal'; this.s.remaining = 0; return this.log('exit', reason); }
  step() {
    const s = this.s, c = this.c; s.spins++;
    let event;
    if (s.mode === 'normal') {
      s.leftSpins++; s.sinceHit++; s.used += 250 / c.spinsPer250;
      const draw = this.rng();
      if (draw < 1 / c.normalOdds) {
        const row = pick(c.normalRows, this.rng); s.paid += row.balls; s.hits++; s.initialHits++; s.chain = 1; s.maxChain = Math.max(s.maxChain, 1); s.rushBalls = row.balls; s.sinceHit = 0;
        const enters = this.rng() < c.entryRate / 100; if (enters) this.enter();
        event = this.log('hit', enters ? '初当たり · 右打ち突入！' : '初当たり · 通常へ', row.balls);
      } else if (c.chargeOdds && draw < 1 / c.normalOdds + 1 / c.chargeOdds) {
        s.paid += c.chargeBalls; s.charges++;
        const enters = this.rng() < c.chargeEntry / 100;
        if (enters) { s.chain = 0; s.rushBalls = c.chargeBalls; this.enter(); }
        event = this.log('charge', enters ? 'チャージ · 右打ち突入！' : 'チャージ', c.chargeBalls);
      } else event = this.log('miss', 'ハズレ');
    } else {
      s.rightSpins++; s.used += c.rightCost;
      if (s.mode === 'st') s.remaining--;
      if (this.rng() < 1 / c.rightOdds) {
        const row = pick(c.rightRows, this.rng); s.paid += row.balls; s.rushBalls += row.balls; s.hits++; s.chain++; s.maxChain = Math.max(s.maxChain, s.chain);
        if (!row.keep) { s.mode = 'normal'; s.remaining = 0; }
        else if (s.mode === 'st') s.remaining = c.stSpins + c.residual;
        event = this.log('hit', row.keep ? `${s.chain}連目 · 右打ち継続！` : `${s.chain}連目 · 通常へ`, row.balls);
      } else if (s.mode === 'fall' && this.rng() < 1 / c.fallOdds) event = this.exit('転落 · 左打ちに戻ります');
      else if (s.mode === 'small' && this.rng() < 1 / c.smallOdds) { s.paid += c.smallBalls; s.rushBalls += c.smallBalls; s.smallHits++; event = this.log('small', '小当たり', c.smallBalls); }
      else event = this.log('miss', 'ハズレ');
      if (s.mode === 'st' && s.remaining === 0) event = this.exit('ST・残保留終了 · 左打ちに戻ります');
    }
    if (this.record && (s.spins % 10 === 0 || event.kind !== 'miss')) {
      s.points.push({ spin: s.spins, net: this.net });
      if (s.points.length > 1200) s.points = s.points.filter((_, i) => i % 2 === 0 || i === s.points.length - 1);
    }
    return event;
  }
}
export function runSession(config, normalLimit, rng, cap = 200000) {
  const m = new Machine(config, rng, false);
  let found = false, right = 0;
  while (!found && m.s.leftSpins < normalLimit) { m.step(); found = m.s.initialHits > 0 || m.s.entries > 0; if (m.s.mode !== 'normal') break; }
  while (m.s.mode !== 'normal' && right < cap) { m.step(); right++; }
  return { net: m.net, paid: m.s.paid, chain: m.s.maxChain, entries: m.s.entries, initial: m.s.initialHits, spins: m.s.spins, limited: m.s.mode !== 'normal' };
}
