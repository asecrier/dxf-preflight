/* DXF Preflight core: parse ASCII DXF, analyse for laser/CNC cutting, repair, export.
   Pure functions, no DOM. Primitives:
   {t:'line', x0,y0,x1,y1, layer}
   {t:'arc', cx,cy,r,a0,sw, layer}   (sw signed sweep in radians, full circle => circle)
   {t:'circle', cx,cy,r, layer} */
const DXF = (() => {
  const TAU = Math.PI * 2;
  const UNIT_MM = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 };
  const INSUNITS = { 1: 'in', 2: 'ft', 4: 'mm', 5: 'cm', 6: 'm' };
  const mod = (a, n) => ((a % n) + n) % n;

  function tokenize(text) {
    const L = text.split(/\r?\n/), out = [];
    for (let i = 0; i + 1 < L.length; i += 2) {
      const c = parseInt(L[i].trim(), 10);
      if (!isNaN(c)) out.push([c, L[i + 1].trim()]);
    }
    return out;
  }

  function records(tokens) {
    const header = {}, blocks = {}, ents = [];
    let section = null, cur = null, curVar = null, curBlock = null;
    const push = r => { if (section === 'ENTITIES') ents.push(r); else if (section === 'BLOCKS' && curBlock) curBlock.ents.push(r); };
    for (const [c, v] of tokens) {
      if (c === 0) {
        if (cur) { if (cur.type === 'BLOCK') { curBlock = blocks[cur.get(2)] = { base: [num(cur.get(10)), num(cur.get(20))], ents: [] }; } else if (cur.type === 'ENDBLK') curBlock = null; else push(cur); cur = null; }
        if (v === 'SECTION') { section = '?'; continue; }
        if (v === 'ENDSEC') { section = null; continue; }
        if (v === 'EOF') break;
        if (section && section !== 'HEADER') cur = mk(v);
        continue;
      }
      if (section === '?' && c === 2) { section = v; continue; }
      if (section === 'HEADER') { if (c === 9) { curVar = v; header[curVar] = {}; } else if (curVar && !(c in header[curVar])) header[curVar][c] = v; continue; }
      if (cur) cur.tags.push([c, v]);
    }
    if (cur) push(cur);
    return { header, blocks, ents };
  }
  const num = v => (v === undefined || v === '' ? 0 : parseFloat(v));
  function mk(type) {
    return { type, tags: [], get(c) { const t = this.tags.find(x => x[0] === c); return t ? t[1] : undefined; }, n(c, d = 0) { const t = this.tags.find(x => x[0] === c); return t ? parseFloat(t[1]) : d; }, all(c) { return this.tags.filter(x => x[0] === c).map(x => parseFloat(x[1])); } };
  }

  // 2x3 affine matrices [a,b,c,d,e,f]: x'=a*x+c*y+e ; y'=b*x+d*y+f
  const I = [1, 0, 0, 1, 0, 0];
  const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
  const ap = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  const det = m => m[0] * m[3] - m[1] * m[2];

  function line(m, x0, y0, x1, y1, layer) { const p = ap(m, x0, y0), q = ap(m, x1, y1); return { t: 'line', x0: p[0], y0: p[1], x1: q[0], y1: q[1], layer }; }
  function arc(m, cx, cy, r, a0, sw, layer, warn) {
    const sc = Math.sqrt(Math.abs(det(m)));
    const c = ap(m, cx, cy), s = ap(m, cx + r * Math.cos(a0), cy + r * Math.sin(a0));
    const sx = Math.hypot(m[0], m[1]), sy = Math.hypot(m[2], m[3]);
    if (Math.abs(sx - sy) > 1e-6 * Math.max(sx, sy)) warn('non-uniform scale on arc/circle approximated');
    if (Math.abs(sw) >= TAU - 1e-9) return { t: 'circle', cx: c[0], cy: c[1], r: r * sc, layer };
    return { t: 'arc', cx: c[0], cy: c[1], r: r * sc, a0: Math.atan2(s[1] - c[1], s[0] - c[0]), sw: det(m) < 0 ? -sw : sw, layer };
  }
  function bulgeSeg(m, p, q, b, layer, warn) {
    if (Math.abs(b) < 1e-12) return line(m, p[0], p[1], q[0], q[1], layer);
    const dx = q[0] - p[0], dy = q[1] - p[1], d = Math.hypot(dx, dy);
    if (d < 1e-12) return null;
    const off = (d / 2) * (1 - b * b) / (2 * b);
    const cx = (p[0] + q[0]) / 2 - (dy / d) * off, cy = (p[1] + q[1]) / 2 + (dx / d) * off;
    const r = d * (1 + b * b) / (4 * Math.abs(b));
    return arc(m, cx, cy, r, Math.atan2(p[1] - cy, p[0] - cx), 4 * Math.atan(b), layer, warn);
  }
  function polySegs(m, vs, closed, layer, warn) {
    const out = [], n = vs.length;
    for (let i = 0; i < (closed ? n : n - 1); i++) { const s = bulgeSeg(m, vs[i], vs[(i + 1) % n], vs[i].b || 0, layer, warn); if (s) out.push(s); }
    return out;
  }
  function sample(f, n, m, layer) { const out = []; let p = f(0); for (let i = 1; i <= n; i++) { const q = f(i / n); out.push(line(m, p[0], p[1], q[0], q[1], layer)); p = q; } return out; }
  function bspline(deg, knots, cps, t) {
    const n = cps.length - 1; let k = deg;
    while (k < n && t >= knots[k + 1]) k++;
    const d = cps.slice(k - deg, k + 1).map(p => [p[0], p[1]]);
    for (let r = 1; r <= deg; r++) for (let j = deg; j >= r; j--) {
      const i = j + k - deg, den = knots[i + deg - r + 1] - knots[i]; const a = den === 0 ? 0 : (t - knots[i]) / den;
      d[j] = [(1 - a) * d[j - 1][0] + a * d[j][0], (1 - a) * d[j - 1][1] + a * d[j][1]];
    }
    return d[deg];
  }

  function convert(rec, m, layerOverride, ctx) {
    const layer = layerOverride || rec.get(8) || '0';
    const warn = w => ctx.warnings.add(w);
    if (rec.n(230, 1) < 0) m = mul(m, [-1, 0, 0, 1, 0, 0]);
    switch (rec.type) {
      case 'LINE': return [line(m, rec.n(10), rec.n(20), rec.n(11), rec.n(21), layer)];
      case 'CIRCLE': return [arc(m, rec.n(10), rec.n(20), rec.n(40), 0, TAU, layer, warn)];
      case 'ARC': { const a0 = rec.n(50) * Math.PI / 180, a1 = rec.n(51) * Math.PI / 180; let sw = mod(a1 - a0, TAU); if (sw < 1e-12) sw = TAU; return [arc(m, rec.n(10), rec.n(20), rec.n(40), a0, sw, layer, warn)]; }
      case 'LWPOLYLINE': {
        const vs = []; let flags = 0;
        for (const [c, v] of rec.tags) { if (c === 70) flags = parseInt(v, 10); else if (c === 10) vs.push([parseFloat(v), 0, 0]); else if (c === 20 && vs.length) vs[vs.length - 1][1] = parseFloat(v); else if (c === 42 && vs.length) vs[vs.length - 1].b = parseFloat(v); }
        return polySegs(m, vs, !!(flags & 1), layer, warn);
      }
      case 'POLYLINE': {
        const vs = rec.vertices.filter(v => !(v.n(70) & 16)).map(v => { const p = [v.n(10), v.n(20)]; p.b = v.n(42); return p; });
        if (rec.n(70) & 64) warn('3D polygon mesh skipped'), vs.length = 0;
        return polySegs(m, vs, !!(rec.n(70) & 1), layer, warn);
      }
      case 'SPLINE': {
        const fit = [], cps = [], kn = rec.all(40), deg = rec.n(71, 3);
        let p = null; for (const [c, v] of rec.tags) { if (c === 10) { p = [parseFloat(v), 0]; cps.push(p); } else if (c === 20 && p) p[1] = parseFloat(v); }
        let q = null; for (const [c, v] of rec.tags) { if (c === 11) { q = [parseFloat(v), 0]; fit.push(q); } else if (c === 21 && q) q[1] = parseFloat(v); }
        warn('splines are approximated with line segments');
        let pts;
        if (cps.length > deg && kn.length === cps.length + deg + 1) { const t0 = kn[deg], t1 = kn[cps.length], N = Math.max(24, cps.length * 8); pts = []; for (let i = 0; i <= N; i++) pts.push(bspline(deg, kn, cps, Math.min(t0 + (t1 - t0) * i / N, t1 - 1e-9))); pts[N] = cps[cps.length - 1]; if (rec.n(70) & 1) pts[N] = pts[0]; }
        else pts = fit.length > 1 ? fit : cps;
        const out = []; for (let i = 0; i + 1 < pts.length; i++) out.push(line(m, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], layer)); return out;
      }
      case 'ELLIPSE': {
        const cx = rec.n(10), cy = rec.n(20), ax = rec.n(11), ay = rec.n(21), k = rec.n(40, 1), t0 = rec.n(41, 0), t1 = rec.n(42, TAU);
        warn('ellipses are approximated with line segments');
        const sweep = t1 - t0 <= 0 ? t1 - t0 + TAU : t1 - t0;
        return sample(t => { const a = t0 + sweep * t; return [cx + ax * Math.cos(a) - ay * k * Math.sin(a), cy + ay * Math.cos(a) + ax * k * Math.sin(a)]; }, 96, m, layer);
      }
      case 'INSERT': {
        const b = ctx.blocks[rec.get(2)]; if (!b || ctx.depth > 8) return [];
        const sx = rec.n(41, 1), sy = rec.n(42, 1), r = rec.n(50) * Math.PI / 180, cs = Math.cos(r), sn = Math.sin(r);
        const rows = Math.max(1, rec.n(70, 1) | 0), cols = Math.max(1, rec.n(71, 1) | 0), rs = rec.n(44), cls = rec.n(45), out = [];
        ctx.depth++;
        for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
          const tm = mul(m, mul([1, 0, 0, 1, rec.n(10) + j * cls, rec.n(20) + i * rs], mul([cs, sn, -sn, cs, 0, 0], mul([sx, 0, 0, sy, 0, 0], [1, 0, 0, 1, -b.base[0], -b.base[1]]))));
          for (const e of b.ents) out.push(...convert(e, tm, e.get(8) === '0' ? rec.get(8) : null, ctx));
        }
        ctx.depth--; return out;
      }
      default: ctx.skipped[rec.type] = (ctx.skipped[rec.type] || 0) + 1; return [];
    }
  }

  function parse(text) {
    if (/^\s*AutoCAD Binary DXF/.test(text.slice(0, 40))) throw new Error('Binary DXF is not supported. Save/export the file as ASCII DXF.');
    const { header, blocks, ents } = records(tokenize(text));
    if (!ents.length) throw new Error('No entities found. Is this an ASCII DXF file?');
    // fold POLYLINE vertices
    const flat = []; let pl = null;
    for (const r of ents) {
      if (r.type === 'POLYLINE') { pl = r; pl.vertices = []; flat.push(r); } else if (r.type === 'VERTEX' && pl) pl.vertices.push(r); else { if (r.type === 'SEQEND') pl = null; else flat.push(r); }
    }
    const ctx = { blocks, depth: 0, skipped: {}, warnings: new Set() };
    const prims = [];
    for (const r of flat) prims.push(...convert(r, I, null, ctx));
    // POLYLINE vertices inside blocks
    const ins = header['$INSUNITS'] ? parseInt(header['$INSUNITS'][70], 10) : 0;
    return { prims: prims.filter(Boolean), insunits: ins, insunitsName: INSUNITS[ins] || null, skipped: ctx.skipped, warnings: [...ctx.warnings], entityCount: flat.length };
  }

  const endpoints = p => p.t === 'line' ? [[p.x0, p.y0], [p.x1, p.y1]] : p.t === 'arc' ? [[p.cx + p.r * Math.cos(p.a0), p.cy + p.r * Math.sin(p.a0)], [p.cx + p.r * Math.cos(p.a0 + p.sw), p.cy + p.r * Math.sin(p.a0 + p.sw)]] : [];
  const lengthOf = p => p.t === 'line' ? Math.hypot(p.x1 - p.x0, p.y1 - p.y0) : p.t === 'arc' ? p.r * Math.abs(p.sw) : TAU * p.r;

  function bbox(prims) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const add = (x, y) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; };
    for (const p of prims) {
      if (p.t === 'line') { add(p.x0, p.y0); add(p.x1, p.y1); }
      else if (p.t === 'circle') { add(p.cx - p.r, p.cy - p.r); add(p.cx + p.r, p.cy + p.r); }
      else { const e = endpoints(p); add(e[0][0], e[0][1]); add(e[1][0], e[1][1]); const lo = Math.min(p.a0, p.a0 + p.sw), hi = Math.max(p.a0, p.a0 + p.sw); for (let k = Math.ceil(lo / (Math.PI / 2)); k * Math.PI / 2 <= hi; k++) { const a = k * Math.PI / 2; add(p.cx + p.r * Math.cos(a), p.cy + p.r * Math.sin(a)); } }
    }
    return prims.length ? { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 } : null;
  }

  // Remove exact duplicates (same geometry within tol). Returns {prims, removed:[prim], removedLength}
  function dedupe(prims, tol) {
    const q = v => Math.round(v / tol), seen = new Set(), keep = [], removed = []; let rl = 0;
    for (const p of prims) {
      let k;
      if (p.t === 'circle') k = `c${q(p.cx)},${q(p.cy)},${q(p.r)}`;
      else if (p.t === 'line') { const a = [q(p.x0), q(p.y0)], b = [q(p.x1), q(p.y1)]; k = 'l' + (a[0] < b[0] || (a[0] === b[0] && a[1] <= b[1]) ? a.concat(b) : b.concat(a)).join(','); }
      else { const e = endpoints(p), a = [q(e[0][0]), q(e[0][1])], b = [q(e[1][0]), q(e[1][1])]; const fwd = p.sw > 0; const s = fwd ? a : b, f = fwd ? b : a; k = `a${q(p.cx)},${q(p.cy)},${q(p.r)},${s},${f}`; }
      if (seen.has(k)) { removed.push(p); rl += lengthOf(p); } else { seen.add(k); keep.push(p); }
    }
    return { prims: keep, removed, removedLength: rl };
  }

  // Cluster endpoints within tol; returns {nodeOf: Int32Array per endpoint (2*i, 2*i+1), nodes:[{pts:[idx], x,y}]}
  function cluster(prims, tol) {
    const pts = []; prims.forEach((p, i) => endpoints(p).forEach((e, j) => pts.push({ x: e[0], y: e[1], prim: i, end: j })));
    const parent = pts.map((_, i) => i), find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    const cell = Math.max(tol, 1e-12), grid = new Map(), key = (a, b) => a + ',' + b;
    pts.forEach((p, i) => { const cx = Math.floor(p.x / cell), cy = Math.floor(p.y / cell); for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) { const g = grid.get(key(cx + dx, cy + dy)); if (g) for (const j of g) if (Math.hypot(pts[j].x - p.x, pts[j].y - p.y) <= tol) parent[find(i)] = find(j); } const k = key(cx, cy); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); });
    const byRoot = new Map(); pts.forEach((p, i) => { const r = find(i); if (!byRoot.has(r)) byRoot.set(r, []); byRoot.get(r).push(i); });
    const nodes = []; byRoot.forEach(ix => { nodes.push({ ix, x: ix.reduce((s, i) => s + pts[i].x, 0) / ix.length, y: ix.reduce((s, i) => s + pts[i].y, 0) / ix.length }); });
    return { pts, nodes };
  }

  /* analyse(prims, tol): tol = endpoint-joining tolerance in drawing units. */
  function analyse(prims, tol, nearMiss) {
    const { pts, nodes } = cluster(prims, tol);
    const nodeOf = new Array(pts.length); nodes.forEach((n, ni) => n.ix.forEach(i => nodeOf[i] = ni));
    // connected components over primitives
    const par = prims.map((_, i) => i), find = i => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
    nodes.forEach(n => { for (let k = 1; k < n.ix.length; k++) par[find(pts[n.ix[k]].prim)] = find(pts[n.ix[0]].prim); });
    const comp = new Map(); prims.forEach((p, i) => { const r = find(i); if (!comp.has(r)) comp.set(r, []); comp.get(r).push(i); });
    const openEnds = nodes.filter(n => n.ix.length === 1);
    const branch = nodes.filter(n => n.ix.length > 2);
    const openComp = new Set(); openEnds.forEach(n => openComp.add(find(pts[n.ix[0]].prim)));
    const circles = prims.filter(p => p.t === 'circle').length;
    // near-miss gaps among open ends
    const gaps = []; const oe = openEnds.slice(0, 3000);
    for (let i = 0; i < oe.length; i++) { let best = null; for (let j = 0; j < oe.length; j++) { if (i === j) continue; const d = Math.hypot(oe[i].x - oe[j].x, oe[i].y - oe[j].y); if (!best || d < best.d) best = { d, j }; } if (best && best.d <= nearMiss && i < best.j) gaps.push({ x: oe[i].x, y: oe[i].y, x2: oe[best.j].x, y2: oe[best.j].y, d: best.d }); }
    return {
      cutLength: prims.reduce((s, p) => s + lengthOf(p), 0),
      shapes: comp.size, closedShapes: comp.size - openComp.size, openShapes: openComp.size,
      circles, pierces: comp.size, openEnds: openEnds.map(n => ({ x: n.x, y: n.y })), branchPoints: branch.length, gaps,
      tinySegments: prims.filter(p => lengthOf(p) < tol).length,
    };
  }

  // Snap clustered endpoints to their centroid; fixes micro-gaps. Returns new prim array.
  function snap(prims, tol) {
    const { pts, nodes } = cluster(prims, tol), out = prims.map(p => Object.assign({}, p));
    for (const n of nodes) {
      if (n.ix.length < 2) continue;
      for (const i of n.ix) {
        const { prim, end } = pts[i], p = out[prim];
        if (p.t === 'line') { if (end === 0) { p.x0 = n.x; p.y0 = n.y; } else { p.x1 = n.x; p.y1 = n.y; } }
        else if (p.t === 'arc') { const ang = Math.atan2(n.y - p.cy, n.x - p.cx); if (end === 0) { const e = p.a0 + p.sw; p.sw = p.sw > 0 ? mod(e - ang, TAU) : -mod(ang - e, TAU); p.a0 = ang; } else { let sw = ang - p.a0; sw = p.sw > 0 ? mod(sw, TAU) : -mod(-sw, TAU); p.sw = sw; } }
      }
    }
    return out.filter(p => lengthOf(p) > 1e-12);
  }

  function transform(prims, k, dx, dy) {
    return prims.map(p => p.t === 'line' ? Object.assign({}, p, { x0: p.x0 * k + dx, y0: p.y0 * k + dy, x1: p.x1 * k + dx, y1: p.y1 * k + dy }) : Object.assign({}, p, { cx: p.cx * k + dx, cy: p.cy * k + dy, r: p.r * k }));
  }

  function toDXF(prims, insunits) {
    const f = v => (Math.abs(v) < 1e-12 ? 0 : +v.toFixed(6)), o = [];
    const w = (c, v) => o.push(String(c), String(v));
    w(0, 'SECTION'); w(2, 'HEADER'); w(9, '$ACADVER'); w(1, 'AC1009'); w(9, '$INSUNITS'); w(70, insunits); w(0, 'ENDSEC');
    w(0, 'SECTION'); w(2, 'ENTITIES');
    for (const p of prims) {
      w(0, p.t === 'line' ? 'LINE' : p.t === 'arc' ? 'ARC' : 'CIRCLE'); w(8, (p.layer || '0').replace(/[\r\n]/g, ''));
      if (p.t === 'line') { w(10, f(p.x0)); w(20, f(p.y0)); w(30, 0); w(11, f(p.x1)); w(21, f(p.y1)); w(31, 0); }
      else { w(10, f(p.cx)); w(20, f(p.cy)); w(30, 0); w(40, f(p.r)); if (p.t === 'arc') { const a = p.sw > 0 ? p.a0 : p.a0 + p.sw, b = a + Math.abs(p.sw); w(50, f(mod(a * 180 / Math.PI, 360))); w(51, f(mod(b * 180 / Math.PI, 360))); } }
    }
    w(0, 'ENDSEC'); w(0, 'EOF');
    return o.join('\r\n') + '\r\n';
  }

  /* Quote: simple, transparent model. All inputs in mm / currency units. */
  function quote(a, s) {
    const cutMin = a.cutLengthMM / s.speed, pierceMin = a.pierces * s.pierceSec / 60;
    const machine = (cutMin + pierceMin) / 60 * s.machineRate;
    const area = (a.widthMM * a.heightMM) / 1e6, material = area * (1 + s.waste / 100) * s.materialPerM2;
    const unit = (machine + material) * (1 + s.markup / 100);
    const total = Math.max(unit * s.qty + s.setup, s.minCharge);
    return { cutMin, pierceMin, machine, material, unit, total, areaM2: area };
  }

  return { parse, analyse, dedupe, snap, transform, toDXF, bbox, endpoints, lengthOf, quote, UNIT_MM, INSUNITS };
})();
if (typeof module !== 'undefined') module.exports = DXF;
