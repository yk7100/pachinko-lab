import { defaults, presets, clone, validate, Machine, theoretical, seeded, runSession, distributionSummary, normalizeDistribution } from './engine.js?v=distribution2';
const $ = id => document.getElementById(id);
const form = $('settings-form');
const format = n => Math.round(n).toLocaleString('ja-JP');
const signed = n => `${n > 0 ? '+' : ''}${format(n)}`;
let config = clone(defaults), machine, timer = null, busy = false, lastEvent = null;
try { const saved = JSON.parse(localStorage.getItem('pachinko-lab-config')); if (saved && validate(saved).length === 0) config = saved; } catch { /* 保存できないブラウザでも動作する */ }
let draftRows = { normal: clone(config.normalRows), right: clone(config.rightRows) };
function modeFields() { document.querySelectorAll('[data-mode]').forEach(el => el.hidden = el.dataset.mode !== form.elements.type.value); }
function loadForm(c) {
  for (const [key, value] of Object.entries(c)) if (form.elements[key]) form.elements[key].value = value;
  draftRows = { normal: clone(c.normalRows), right: clone(c.rightRows) };
  $('preset').value = c.type; modeFields(); renderRows();
}
function readForm() {
  const c = clone(config);
  for (const key of Object.keys(c)) if (form.elements[key]) c[key] = key === 'type' ? form.elements[key].value : form.elements[key].value.trim() === '' ? NaN : Number(form.elements[key].value);
  c.name = `カスタム ${ { st: 'ST', fall: '転落', small: '小当たりRUSH' }[c.type] }`;
  c.normalRows = clone(draftRows.normal); c.rightRows = clone(draftRows.right);
  return c;
}
function totals() {
  for (const kind of ['normal', 'right']) {
    const summary = distributionSummary(draftRows[kind]);
    $(`${kind}-total`).textContent = `合計 ${summary.text}% / 100%`;
    $(`${kind}-total`).classList.toggle('invalid', !summary.complete);
  }
}
function renderRows() {
  for (const kind of ['normal', 'right']) {
    const container = $(`${kind}-rows`); container.replaceChildren();
    draftRows[kind].forEach((row, i) => {
      const el = document.createElement('div'); el.className = `distribution-row ${kind === 'right' ? 'right' : ''}`;
      for (const [key, unit, max] of [['balls', '玉', 100000], ['weight', '%', 100]]) {
        const wrap = document.createElement('span'); wrap.className = 'input-wrap';
        const input = document.createElement('input'); input.type = 'number'; input.min = 0; input.max = max; input.step = key === 'balls' ? '1' : 'any'; input.value = row[key]; input.setAttribute('aria-label', `${kind === 'right' ? '右打ち' : '初当たり'}振り分け${i + 1}の${key === 'balls' ? '出玉' : '割合'}`);
        input.addEventListener('input', () => { row[key] = input.value.trim() === '' ? NaN : Number(input.value); totals(); dirty(); });
        const suffix = document.createElement('span'); suffix.textContent = unit; wrap.append(input, suffix); el.append(wrap);
      }
      if (kind === 'right') {
        const select = document.createElement('select'); select.setAttribute('aria-label', `右打ち振り分け${i + 1}の終了後`);
        select.innerHTML = '<option value="true">継続</option><option value="false">終了</option>'; select.value = String(row.keep); select.addEventListener('change', () => { row.keep = select.value === 'true'; dirty(); }); el.append(select);
      }
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'remove-row'; remove.textContent = '×'; remove.setAttribute('aria-label', `振り分け${i + 1}を削除`); remove.disabled = draftRows[kind].length === 1; remove.addEventListener('click', () => { draftRows[kind].splice(i, 1); renderRows(); dirty(); }); el.append(remove); container.append(el);
    });
  }
  totals();
}
function dirty() { $('settings-status').textContent = '変更を反映するには「設定を適用」を押してください'; }
document.querySelectorAll('[data-add]').forEach(button => button.addEventListener('click', () => { const kind = button.dataset.add; if (draftRows[kind].length >= 20) return; draftRows[kind].push({ balls: 1500, weight: 0, ...(kind === 'right' ? { keep: true } : {}) }); renderRows(); dirty(); }));
document.querySelectorAll('[data-normalize]').forEach(button => button.addEventListener('click', () => {
  try {
    const kind = button.dataset.normalize;
    draftRows[kind] = normalizeDistribution(draftRows[kind]);
    $('settings-error').hidden = true; renderRows(); dirty();
  } catch (error) { $('settings-error').textContent = error.message; $('settings-error').hidden = false; }
}));
const tabs = [...document.querySelectorAll('[data-tab]')];
function activateTab(button) { tabs.forEach(b => { const selected = b === button; b.classList.toggle('selected', selected); b.setAttribute('aria-selected', selected); b.tabIndex = selected ? 0 : -1; $(`${b.dataset.tab}-settings`).hidden = !selected; }); }
tabs.forEach((button, i) => { button.addEventListener('click', () => activateTab(button)); button.addEventListener('keydown', e => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) { e.preventDefault(); const next = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length; activateTab(tabs[next]); tabs[next].focus(); } }); });
activateTab(tabs[0]);
form.addEventListener('input', dirty); form.elements.type.addEventListener('change', modeFields);
$('preset').addEventListener('change', () => { loadForm(clone(presets[$('preset').value])); dirty(); });
form.addEventListener('submit', e => {
  e.preventDefault(); if (busy) return;
  const c = readForm(), errors = validate(c); $('settings-error').hidden = errors.length === 0; $('settings-error').textContent = errors.join('\n');
  if (errors.length) { $('settings-error').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); return; }
  stopAuto(); config = c; reset();
  try { localStorage.setItem('pachinko-lab-config', JSON.stringify(config)); $('settings-status').textContent = '設定を適用・保存しました'; } catch { $('settings-status').textContent = '設定を適用しました（ブラウザへの保存はできません）'; }
});
function chart() {
  const s = machine.s, points = [...s.points];
  if (points[points.length - 1].spin !== s.spins) points.push({ spin: s.spins, net: machine.net });
  const width = Math.max(240, $('chart').clientWidth), height = 180, left = 60, right = 14, top = 12, bottom = 24;
  let lo = Math.min(0, ...points.map(p => p.net)), hi = Math.max(0, ...points.map(p => p.net));
  if (lo === hi) { lo = -1000; hi = 1000; } else { const gap = (hi - lo) * .13; lo -= gap; hi += gap; }
  const x = spin => left + spin / Math.max(s.spins, 100) * (width - left - right);
  const y = net => top + (hi - net) / (hi - lo) * (height - top - bottom);
  let grid = '';
  for (let i = 0; i < 4; i++) { const value = lo + (hi - lo) * i / 3; grid += `<line x1="${left}" x2="${width - right}" y1="${y(value)}" y2="${y(value)}" stroke="#273744" stroke-dasharray="3 5"/><text x="${left - 10}" y="${y(value) + 4}" fill="#7e92a9" text-anchor="end" font-size="11" font-family="monospace">${format(value)}</text>`; }
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.spin).toFixed(2)},${y(p.net).toFixed(2)}`).join(' ');
  $('chart').innerHTML = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#59edbc" stop-opacity=".18"/><stop offset="1" stop-color="#59edbc" stop-opacity="0"/></linearGradient></defs>${grid}<line x1="${left}" x2="${width - right}" y1="${y(0)}" y2="${y(0)}" stroke="#476052"/><path d="${path} L${x(s.spins)},${height - bottom} L${left},${height - bottom} Z" fill="url(#area)"/><path d="${path}" fill="none" stroke="#59edbc" stroke-width="2" vector-effect="non-scaling-stroke"/><text x="${left}" y="${height - 3}" fill="#7e92a9" font-size="11">0</text><text x="${width - right}" y="${height - 3}" fill="#7e92a9" text-anchor="end" font-size="11">${format(Math.max(s.spins, 100))}</text></svg>`;
  $('chart').setAttribute('aria-label', `総回転${format(s.spins)}回、現在の差玉${signed(machine.net)}玉のグラフ`);
}
function history() {
  const kinds = { hit: '大当たり', charge: 'チャージ', small: '小当たり', exit: '終了' };
  $('history').innerHTML = machine.s.events.length ? machine.s.events.map(e => `<tr><td>${format(e.spin)}</td><td><span class="event-kind ${e.kind}">${kinds[e.kind]}</span>${e.text}</td><td class="${e.balls > 0 ? 'positive' : ''}">${e.balls ? '+' + format(e.balls) : '—'}</td><td>${signed(e.net)}</td></tr>`).join('') : '<tr><td colspan="4" class="empty">まだ当たりはありません。回して履歴を残しましょう。</td></tr>';
}
function render(updateHistory = true) {
  const s = machine.s, c = config, rush = s.mode !== 'normal';
  $('machine').classList.toggle('rush', rush); $('machine-name').textContent = c.name;
  $('mode-badge').textContent = rush ? `右打ち · ${{ st: 'ST', small: '小当たりRUSH', fall: '転落' }[s.mode]}` : '左打ち · 通常';
  $('screen-label').textContent = rush ? 'RUSH MODE' : 'NORMAL MODE';
  $('screen-probability').textContent = `大当たり 1/${rush ? c.rightOdds : c.normalOdds}`;
  $('since-hit').textContent = format(s.sinceHit);
  $('remaining-label').innerHTML = s.mode === 'st' ? `残り <b>${format(s.remaining)}</b> 回転${s.remaining <= c.residual ? '（残保留）' : ''}` : rush ? `今回のRUSH <b>${format(s.rushBalls)}</b> 玉` : `右打ち突入率 <b>${c.entryRate}%</b>`;
  $('screen-message').textContent = s.spins ? (s.last === '開始待ち' ? '通常時を抽選中…' : s.last) : '1回転から、はじめよう。';
  $('net').innerHTML = `${signed(machine.net)}<small> 玉</small>`; $('net').classList.toggle('negative', machine.net < 0);
  $('paid-used').textContent = `獲得 ${format(s.paid)} / 消費 ${format(s.used)}`;
  $('hits').innerHTML = `${format(s.hits)}<small> 回</small>`; $('initial-hits').textContent = `初当たり ${format(s.initialHits)} 回`;
  $('max-chain').innerHTML = `${format(s.maxChain)}<small> 連</small>`; $('rush-count').textContent = `右打ち突入 ${format(s.entries)} 回`;
  $('spins').innerHTML = `${format(s.spins)}<small> 回</small>`; $('spin-split').textContent = `左 ${format(s.leftSpins)} / 右 ${format(s.rightSpins)}`;
  $('session-small').textContent = `チャージ ${format(s.charges)} 回 / 小当たり ${format(s.smallHits)} 回`;
  chart(); if (updateHistory) history();
  const t = theoretical(c);
  $('theory').innerHTML = `<span>右打ち継続率（理論値）</span><strong>${(t.cycle * 100).toFixed(1)}<small style="display:inline"> %</small></strong><small>当たり後の終了振り分けを含む</small>`;
}
function reels(event) {
  const nodes = document.querySelectorAll('.reels span');
  if (event?.kind === 'hit') { nodes.forEach(el => el.textContent = '7'); $('machine').classList.remove('win'); void $('machine').offsetWidth; $('machine').classList.add('win'); }
  else { const values = Array.from({ length: 3 }, () => Math.floor(Math.random() * 9) + 1); if (values.every(v => v === values[0])) values[1] = values[0] % 9 + 1; nodes.forEach((el, i) => el.textContent = values[i]); }
}
function turn() { lastEvent = machine.step(); return lastEvent; }
function reset() { machine = new Machine(config); lastEvent = null; document.querySelectorAll('.reels span').forEach((el, i) => el.textContent = ['3', '1', '9'][i]); $('batch-result').hidden = true; $('batch-status').textContent = '適用中の設定を使います。同じシードなら結果を再現できます。'; $('machine').classList.remove('win'); render(); }
function controls() {
  ['spin', 'spin100', 'until-hit', 'reset', 'batch-run'].forEach(id => $(id).disabled = busy || (timer !== null && id !== 'reset'));
  $('auto').disabled = busy; form.querySelector('[type=submit]').disabled = busy; $('preset').disabled = busy;
}
function stopAuto() { if (timer !== null) clearInterval(timer); timer = null; $('auto').textContent = '自動でまわす'; $('auto').classList.remove('running'); controls(); }
function startAuto() {
  stopAuto(); $('auto').textContent = '自動を停止'; $('auto').classList.add('running');
  const speed = Number($('speed').value);
  timer = setInterval(() => {
    let event, resultEvent = null;
    for (let i = 0; i < Math.max(1, speed / 10); i++) {
      event = turn();
      if (event.kind !== 'miss') resultEvent = event;
    }
    reels(resultEvent ?? event); render(resultEvent !== null);
  }, speed === 1 ? 1000 : 100);
  controls();
}
$('auto').addEventListener('click', () => timer === null ? startAuto() : stopAuto()); $('speed').addEventListener('change', () => { if (timer !== null) startAuto(); });
$('reset').addEventListener('click', () => { stopAuto(); reset(); });
$('spin').addEventListener('click', () => { const event = turn(); reels(event); render(); });
const yieldUI = () => new Promise(resolve => setTimeout(resolve, 0));
async function advance(count, untilHit = false) {
  if (busy || timer !== null) return; busy = true; controls(); let event, performed = 0, reached = false;
  try {
    while (performed < count && !reached) {
      for (let i = 0; i < 500 && performed < count; i++) { event = turn(); performed++; if (event.kind === 'hit' || event.kind === 'exit' || (event.kind === 'charge' && machine.s.mode !== 'normal')) { reached = true; break; } }
      await yieldUI();
    }
    reels(event); render();
    if (untilHit && !reached) $('screen-message').textContent = '10万回転に達しました。続けて試せます。';
  } finally { busy = false; controls(); }
}
$('spin100').addEventListener('click', () => advance(100)); $('until-hit').addEventListener('click', () => advance(100000, true));
$('download').addEventListener('click', () => {
  const rows = [['回転', '結果', '出玉', '差玉'], ...[...machine.s.events].reverse().map(e => [e.spin, e.text, e.balls, Math.round(e.net)])];
  const blob = new Blob(['\ufeff' + rows.map(r => r.map(v => `"${String(v).replaceAll('"', '""')}"`).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = 'pachinko-history.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$('help-open').addEventListener('click', () => $('help').showModal()); $('help-close').addEventListener('click', () => $('help').close()); $('help').addEventListener('click', e => { if (e.target === $('help')) { const r = $('help').getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) $('help').close(); } });
$('batch-run').addEventListener('click', async () => {
  if (busy || timer !== null) return;
  const count = Number($('batch-count').value), limit = Number($('batch-limit').value), seed = Number($('seed').value);
  if (!$('batch-limit').value.trim() || !Number.isInteger(limit) || limit < 1 || limit > 10000 || !$('seed').value.trim() || !Number.isInteger(seed) || seed < 0 || seed > 4294967295) { $('batch-status').textContent = '通常時の上限は1〜10,000回転、シードは0〜4,294,967,295の整数を入力してください。'; return; }
  if (theoretical(config).cycle === 1 && (config.entryRate > 0 || (config.chargeOdds && config.chargeEntry > 0))) { $('batch-status').textContent = 'この設定は右打ちが終了しません。終了振り分けや当たり・転落確率を調整してください。'; return; }
  busy = true; controls(); $('batch-result').hidden = true; $('batch-progress').hidden = false; $('batch-progress').value = 0;
  const rng = seeded(seed), results = []; let processed = 0, excluded = 0, work = 0;
  try {
    while (processed < count && work < 10000000) {
      const started = performance.now();
      do { const result = runSession(config, limit, rng); processed++; work += result.spins; if (result.limited) excluded++; else results.push(result); } while (processed < count && work < 10000000 && performance.now() - started < 30);
      $('batch-progress').value = processed / count * 100; $('batch-status').textContent = `${format(processed)} / ${format(count)} 回を計算中…`; await yieldUI();
    }
    const n = results.length;
    if (!n) { $('batch-status').textContent = '全試行が右打ち20万回転の上限に達しました。終了しやすい設定で再実行してください。'; return; }
    const sum = key => results.reduce((s, r) => s + r[key], 0), wins = results.filter(r => r.net > 0).length, nets = results.map(r => r.net).sort((a, b) => a - b);
    const bucketLabels = ['1連', '2–3連', '4–6連', '7–10連', '11–20連', '21連+'];
    const buckets = Array(6).fill(0); let noHit = 0;
    for (const r of results) { if (!r.chain) noHit++; else buckets[r.chain === 1 ? 0 : r.chain <= 3 ? 1 : r.chain <= 6 ? 2 : r.chain <= 10 ? 3 : r.chain <= 20 ? 4 : 5]++; }
    const max = Math.max(1, ...buckets), entry = sum('entries');
    const median = n % 2 ? nets[Math.floor(n / 2)] : (nets[n / 2 - 1] + nets[n / 2]) / 2;
    $('batch-result').innerHTML = `<div class="batch-results"><div><span>平均差玉</span><strong>${signed(sum('net') / n)}<small> 玉</small></strong></div><div><span>差玉プラスの割合</span><strong>${(wins / n * 100).toFixed(1)}<small> %</small></strong></div><div><span>平均最大連チャン</span><strong>${(sum('chain') / n).toFixed(2)}<small> 連</small></strong></div><div><span>右打ち突入あり</span><strong>${(entry / n * 100).toFixed(1)}<small> %</small></strong></div></div><p class="hint">差玉の中央値 ${signed(median)}玉 / 下位10% ${signed(nets[Math.floor((n - 1) * .1)])}玉 / 上位10% ${signed(nets[Math.floor((n - 1) * .9)])}玉</p><p class="hist-label">最大連チャンの分布（初当たり込み）</p><div class="histogram" role="img" aria-label="最大連チャン分布">${buckets.map((value, i) => `<div class="hist-bar" style="height:${Math.max(2, value / max * 92)}px"><b>${format(value)}回</b><span>${bucketLabels[i]}</span></div>`).join('')}</div><p class="hint">当たりなし ${format(noHit)}回 / 有効試行 ${format(n)}回 / シード ${seed}</p>`;
    $('batch-result').hidden = false;
    $('batch-status').textContent = `${format(processed)}回の計算が完了。${excluded ? `右打ち上限に達した${format(excluded)}回を除外。` : ''}${processed < count ? '計算量の上限に達したため、ここまでの試行を集計しています。' : ''}`;
  } catch { $('batch-status').textContent = '計算中に問題が発生しました。設定を確認して再実行してください。'; }
  finally { busy = false; controls(); $('batch-progress').hidden = true; }
});
loadForm(config); reset();
window.addEventListener('resize', chart);
