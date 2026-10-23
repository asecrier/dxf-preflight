const CONFIG = { contactEmail: '', buyUrl: '' }; // fill in when real contact / checkout exist
const $ = id => document.getElementById(id);
let S = null; // current state

function showErr(msg) { const e = $('err'); e.textContent = msg; e.classList.toggle('hid', !msg); }
function load(file) {
  showErr('');
  const r = new FileReader();
  r.onload = () => {
    try { init(file.name, DXF.parse(String(r.result))); } catch (e) { $('result').classList.add('hid'); showErr(e.message); }
  };
  r.onerror = () => showErr('Could not read the file.');
  r.readAsText(file);
}

function guessUnit(parsed, bb) {
  const dim = Math.max(bb.w, bb.h);
  if (parsed.insunitsName) return { unit: parsed.insunitsName, note: `File declares ${parsed.insunitsName} (INSUNITS=${parsed.insunits}).`, suspicious: (parsed.insunitsName === 'in' && dim > 200) || (parsed.insunitsName === 'mm' && dim < 4) ? `Declared unit looks wrong: the drawing is ${dim.toFixed(2)} units wide. Check the unit selector.` : '' };
  return { unit: 'mm', note: 'File does not declare units – assumed mm. Verify with the dimensions shown.', suspicious: dim < 4 ? 'The drawing is very small; it may be in inches or metres.' : dim > 5000 ? 'The drawing is very large; check units.' : '' };
}

function init(name, parsed) {
  if (!parsed.prims.length) throw new Error('The file contains no supported cut geometry (LINE/ARC/CIRCLE/POLYLINE/SPLINE/ELLIPSE).');
  const bb = DXF.bbox(parsed.prims), g = guessUnit(parsed, bb);
  S = { name, parsed, prims: parsed.prims, bb, guess: g };
  $('unit').value = g.unit; $('forceW').value = '';
  $('fname').textContent = name; $('result').classList.remove('hid');
  refresh();
}

const mmPerUnit = () => DXF.UNIT_MM[$('unit').value];
const fmt = (v, d = 2) => Number(v).toLocaleString('en', { maximumFractionDigits: d });

function refresh() {
  const k = mmPerUnit(), prims = S.prims;
  const strict = 0.001 / k, join = Math.max(parseFloat($('joinTol').value) || 0, 0) / k;
  const dd = DXF.dedupe(prims, strict);
  const a = DXF.analyse(dd.prims, strict, Math.max(join * 20, 1 / k));
  const aJoin = DXF.analyse(dd.prims, Math.max(join, strict), 0);
  S.view = { dd, a, aJoin, k };
  const forceW = parseFloat($('forceW').value), scale = forceW > 0 ? forceW / (S.bb.w * k) : 1;
  const wMM = S.bb.w * k * scale, hMM = S.bb.h * k * scale;
  S.out = { widthMM: wMM, heightMM: hMM, cutLengthMM: a.cutLength * k * scale, pierces: a.pierces, scale };

  const issues = [];
  const add = (c, t) => issues.push(`<div class="issue ${c}">${t}</div>`);
  const big = Math.max(wMM, hMM);
  if (big > 3200) add('warn', `<b>Part is ${fmt(big / 1000, 2)} m long – larger than a typical sheet.</b> The unit is probably wrong (e.g. file is in mm but tagged inches). Try another unit.`);
  else if (big < 3) add('warn', `<b>Part is only ${fmt(big, 2)} mm long.</b> The unit is probably wrong (e.g. inches or metres read as mm).`);
  add('warn', `Size at selected units (${$('unit').value}): <b>${fmt(wMM)} × ${fmt(hMM)} mm</b>. ${S.guess.note} If this is not the real size, change units or force the width.`);
  if (a.openShapes) add('bad', `<b>${a.openShapes}</b> open shape(s), <b>${a.openEnds.length}</b> loose end(s) at 0.001 mm tolerance.` + (aJoin.openShapes < a.openShapes ? ` Joining gaps up to ${$('joinTol').value} mm closes ${a.openShapes - aJoin.openShapes}.` : ''));
  else add('ok', 'No open shapes at 0.001 mm tolerance.');
  if (a.gaps.length) add('bad', `${a.gaps.length} near-miss gap(s) between loose ends (largest ${fmt(Math.max(...a.gaps.map(x => x.d)) * k, 3)} mm).`);
  if (dd.removed.length) add('bad', `<b>${dd.removed.length}</b> duplicate entities (${fmt(dd.removedLength * k)} mm of double cutting).`);
  else add('ok', 'No duplicate entities.');
  if (a.tinySegments) add('warn', `${a.tinySegments} segment(s) shorter than 0.001 mm.`);
  if (a.branchPoints) add('warn', `${a.branchPoints} junction(s) where 3+ lines meet (shared edges or T-junctions). Pierce count is an estimate.`);
  for (const w of S.parsed.warnings) add('warn', w[0].toUpperCase() + w.slice(1) + '.');
  const sk = Object.entries(S.parsed.skipped); if (sk.length) add('warn', 'Ignored (not cut geometry): ' + sk.map(([t, n]) => `${t}×${n}`).join(', ') + '.');
  $('issues').innerHTML = issues.join('');
  $('unitNote').textContent = scale !== 1 ? `Scale factor applied on export: ${scale.toFixed(6)}` : '';

  $('stats').innerHTML = [['Cut length', fmt(S.out.cutLengthMM / 1000, 3) + ' m'], ['Pierces', a.pierces], ['Closed / open', `${a.closedShapes} / ${a.openShapes}`], ['Entities', prims.length], ['Width × height', `${fmt(wMM)} × ${fmt(hMM)} mm`], ['Bounding area', fmt(wMM * hMM / 1e6, 4) + ' m²']].map(([l, v]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join('');
  draw(prims, dd.removed, a);
  renderQuote();
}

function draw(prims, dups, a) {
  const cv = $('cv'), ctx = cv.getContext('2d'), W = cv.width, H = cv.height, bb = S.bb, pad = 20;
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H);
  const s = Math.min((W - 2 * pad) / (bb.w || 1), (H - 2 * pad) / (bb.h || 1)), ox = pad + ((W - 2 * pad) - bb.w * s) / 2, oy = H - pad - ((H - 2 * pad) - bb.h * s) / 2;
  ctx.setTransform(s, 0, 0, -s, ox - bb.x0 * s, oy + bb.y0 * s);
  const stroke = (list, col) => {
    ctx.beginPath();
    for (const p of list) {
      if (p.t === 'line') { ctx.moveTo(p.x0, p.y0); ctx.lineTo(p.x1, p.y1); }
      else if (p.t === 'circle') { ctx.moveTo(p.cx + p.r, p.cy); ctx.arc(p.cx, p.cy, p.r, 0, Math.PI * 2); }
      else { const e = DXF.endpoints(p); ctx.moveTo(e[0][0], e[0][1]); ctx.arc(p.cx, p.cy, p.r, p.a0, p.a0 + p.sw, p.sw < 0); }
    }
    ctx.setLineDash([]); ctx.strokeStyle = col; ctx.lineWidth = (col === '#e08a00' ? 4 : 2.5) / s; ctx.stroke();
  };
  stroke(prims, '#1b4f8a'); stroke(dups, '#e08a00');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const sp = (x, y) => [ox + (x - bb.x0) * s, oy - (y - bb.y0) * s];
  const dot = (x, y, col, r) => { const q = sp(x, y); ctx.beginPath(); ctx.arc(q[0], q[1], r, 0, 7); ctx.fillStyle = col; ctx.fill(); };
  a.openEnds.slice(0, 2000).forEach(p => dot(p.x, p.y, '#c62828', 5));
  a.gaps.slice(0, 500).forEach(g => { dot(g.x, g.y, '#7a1fa2', 7); dot(g.x2, g.y2, '#7a1fa2', 7); });
}

function renderQuote() {
  if (!S) return;
  const g = id => parseFloat($(id).value) || 0, s = { qty: Math.max(1, g('q_qty')), speed: Math.max(1, g('q_speed')), pierceSec: g('q_pierce'), machineRate: g('q_rate'), materialPerM2: g('q_mat'), waste: g('q_waste'), markup: g('q_markup'), setup: g('q_setup'), minCharge: g('q_min') };
  const q = DXF.quote(S.out, s), cur = $('q_cur').value || '', m = v => fmt(v, 2) + ' ' + cur;
  S.q = { q, s, cur };
  const rows = [['Cut time per part', fmt(q.cutMin, 2) + ' min'], ['Pierce time per part', fmt(q.pierceMin, 2) + ' min'], ['Machine cost per part', m(q.machine)], ['Material per part', m(q.material)], ['Price per part (with markup)', m(q.unit)], ['Total for ' + s.qty + ' (incl. setup, min. charge)', '<b>' + m(q.total) + '</b>']];
  $('qtable').innerHTML = rows.map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`).join('');
  try { localStorage.setItem('dxfpf_rates', JSON.stringify(Object.fromEntries([...document.querySelectorAll('[id^=q_]')].map(e => [e.id, e.value])))); } catch (e) { }
}

function esc(t) { return String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function printQuote() {
  const { q, s, cur } = S.q, m = v => fmt(v, 2) + ' ' + esc(cur), o = S.out;
  $('print').innerHTML = `<h1>Quote</h1><p>File: ${esc(S.name)} · ${new Date().toISOString().slice(0, 10)}</p><table>
  <tr><td>Part size</td><td>${fmt(o.widthMM)} × ${fmt(o.heightMM)} mm</td></tr><tr><td>Cut length</td><td>${fmt(o.cutLengthMM / 1000, 3)} m</td></tr><tr><td>Pierces</td><td>${o.pierces}</td></tr>
  <tr><td>Quantity</td><td>${s.qty}</td></tr><tr><td>Price per part</td><td>${m(q.unit)}</td></tr><tr><td><b>Total</b></td><td><b>${m(q.total)}</b></td></tr></table>
  <p><small>Estimate generated by DXF Preflight from file geometry. Final price subject to confirmation.</small></p>`;
  window.print();
}

function fixAndDownload() {
  const k = mmPerUnit(), join = Math.max(parseFloat($('joinTol').value) || 0, 0) / k, strict = 0.001 / k;
  let p = S.prims;
  if ($('dedupe').value === '1') p = DXF.dedupe(p, strict).prims;
  if (join > 0) p = DXF.snap(p, join);
  if ($('dedupe').value === '1') p = DXF.dedupe(p, strict).prims;
  const f = k * S.out.scale;
  p = DXF.transform(p, f, -S.bb.x0 * f, -S.bb.y0 * f);
  const blob = new Blob([DXF.toDXF(p, 4)], { type: 'application/dxf' }), a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = S.name.replace(/\.dxf$/i, '') + '_fixed.dxf'; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  S.fixed = DXF.toDXF(p, 4);
}
function recheck() {
  if (!S.fixed) fixAndDownload();
  const keep = S.name; init(keep.replace(/\.dxf$/i, '') + '_fixed.dxf', DXF.parse(S.fixed)); $('unit').value = 'mm';
  refresh();
}

$('drop').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', e => e.target.files[0] && load(e.target.files[0]));
['dragover', 'dragenter'].forEach(ev => $('drop').addEventListener(ev, e => { e.preventDefault(); $('drop').classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => $('drop').addEventListener(ev, e => { e.preventDefault(); $('drop').classList.remove('over'); }));
$('drop').addEventListener('drop', e => e.dataTransfer.files[0] && load(e.dataTransfer.files[0]));
['unit', 'forceW', 'joinTol', 'dedupe'].forEach(id => $(id).addEventListener('input', () => { S && (S.fixed = null, refresh()); }));
document.querySelectorAll('[id^=q_]').forEach(e => e.addEventListener('input', renderQuote));
$('fix').addEventListener('click', () => S && fixAndDownload());
$('recheck').addEventListener('click', () => S && recheck());
$('printBtn').addEventListener('click', () => S && printQuote());
try { const r = JSON.parse(localStorage.getItem('dxfpf_rates') || '{}'); for (const id in r) if ($(id)) $(id).value = r[id]; } catch (e) { }
if (CONFIG.contactEmail) $('contact').innerHTML = `Feedback: <a href="mailto:${esc(CONFIG.contactEmail)}">${esc(CONFIG.contactEmail)}</a>`;
