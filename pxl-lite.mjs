#!/usr/bin/env node
// pxl-lite: pixel art as code in one file. The sprite core of crsolver/claude-pxl (MIT, see NOTICE):
// palettes, text-grid sprites, mirror/outline/swap/flip/rot variants, shape primitives, sprite sheets
// with TexturePacker JSON, upscaled previews. Plain JavaScript, Node 18+, no packages.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { deflateSync } from 'node:zlib';

// ---------------------------------------------------------------- colors and palettes
const T = 0; // transparent; colors are packed 0xRRGGBBAA
const pack = (r, g, b, a = 255) => (((r & 255) << 24) | ((g & 255) << 16) | ((b & 255) << 8) | (a & 255)) >>> 0;
const darken = (c, k) => pack(((c >>> 24) & 255) * (1 - k), ((c >>> 16) & 255) * (1 - k), ((c >>> 8) & 255) * (1 - k));
function parseHex(s) {
  let h = s.startsWith('#') ? s.slice(1) : s;
  if (!/^[0-9a-fA-F]+$/.test(h)) return undefined;
  if (h.length === 3 || h.length === 4) h = h.replace(/./g, (d) => d + d);
  if (h.length === 6) h += 'ff';
  if (h.length !== 8) return undefined;
  const c = parseInt(h, 16) >>> 0;
  return (c & 255) === 0 ? T : c;
}
const INDEX_KEYS = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
export const BUILTIN = {
  pico8: ['000000', '1d2b53', '7e2553', '008751', 'ab5236', '5f574f', 'c2c3c7', 'fff1e8', 'ff004d', 'ffa300', 'ffec27', '00e436', '29adff', '83769c', 'ff77a8', 'ffccaa'],
  sweetie16: ['1a1c2c', '5d275d', 'b13e53', 'ef7d57', 'ffcd75', 'a7f070', '38b764', '257179', '29366f', '3b5dc9', '41a6f6', '73eff7', 'f4f4f4', '94b0c2', '566c86', '333c57'],
};

class Palette {
  constructor(keys, list, aliases) { this.keys = keys; this.list = list; this.aliases = aliases; }
  static from(colors) {
    const list = colors.map((c) => { const v = typeof c === 'number' ? c >>> 0 : parseHex(c); if (v === undefined) throw new Error(`bad palette color '${c}'`); return v; });
    return new Palette(new Map(list.slice(0, INDEX_KEYS.length).map((c, i) => [INDEX_KEYS[i], c])), list, new Set());
  }
  extend(map) {
    const keys = new Map(this.keys), al = new Set(this.aliases);
    for (const [k, v] of Object.entries(map)) {
      if ([...k].length !== 1 || '._ #'.includes(k)) throw new Error(`palette key must be one character other than . _ space #, got '${k}'`);
      const c = typeof v === 'number' ? this.list[v] : [...v].length === 1 ? keys.get(v) : parseHex(v);
      if (c === undefined) throw new Error(`bad color ${JSON.stringify(v)} for key '${k}'`);
      keys.set(k, c); al.add(k);
    }
    return new Palette(keys, this.list, al);
  }
  /** "." skip (null), "_" erase, "#hex", or a key. */
  resolve(s) {
    if (s === '.') return null;
    if (s === '_') return T;
    if (typeof s === 'number') return s >>> 0;
    if (typeof s === 'string' && s.startsWith('#')) { const c = parseHex(s); if (c === undefined) throw new Error(`bad color '${s}'`); return c; }
    const c = this.keys.get(s);
    if (c === undefined) throw new Error(`unknown color key ${JSON.stringify(s)} (have: ${[...this.keys.keys()].join('')})`);
    return c;
  }
  /** color -> key, preferring keys set with pal() over index keys */
  reverse() {
    const r = new Map();
    for (const [k, c] of this.keys) { const cur = r.get(c); if (cur === undefined || (this.aliases.has(k) && !this.aliases.has(cur))) r.set(c, k); }
    return r;
  }
}

// ---------------------------------------------------------------- images
export class Img {
  constructor(w, h, data) {
    w = Math.floor(w); h = Math.floor(h);
    if (!(w >= 1 && h >= 1)) throw new Error(`image size must be positive, got ${w}x${h}`);
    if (w * h > 16_777_216) throw new Error(`image too large: ${w}x${h}`);
    Object.assign(this, { w, h, data: data ?? new Uint32Array(w * h) });
  }
  inside(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  get(x, y) { x = Math.floor(x); y = Math.floor(y); return this.inside(x, y) ? this.data[y * this.w + x] : T; }
  set(x, y, c) { x = Math.floor(x); y = Math.floor(y); if (this.inside(x, y)) this.data[y * this.w + x] = c; }
  copy() { return new Img(this.w, this.h, this.data.slice()); }
  map(w, h, f) { const o = new Img(w, h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) o.data[y * w + x] = f(x, y); return o; }
  blit(src, dx, dy) { for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) { const c = src.data[y * src.w + x]; if (c !== T) this.set(dx + x, dy + y, c); } }
  flip(axis) { const fx = axis.includes('x'), fy = axis.includes('y'); return this.map(this.w, this.h, (x, y) => this.get(fx ? this.w - 1 - x : x, fy ? this.h - 1 - y : y)); }
  /** clockwise, multiples of 90 */
  rot(deg) {
    const d = ((deg % 360) + 360) % 360;
    if (d === 0) return this.copy();
    if (d === 180) return this.flip('xy');
    if (d !== 90 && d !== 270) throw new Error(`rot must be a multiple of 90, got ${deg}`);
    return this.map(this.h, this.w, (x, y) => (d === 90 ? this.get(y, this.h - 1 - x) : this.get(this.w - 1 - y, x)));
  }
  /** copy the left half onto the right ("x") or the top onto the bottom ("y"), in place */
  mirror(axis) {
    if (axis === 'x') { for (let y = 0; y < this.h; y++) for (let x = 0; x < Math.floor(this.w / 2); x++) this.set(this.w - 1 - x, y, this.get(x, y)); }
    else for (let y = 0; y < Math.floor(this.h / 2); y++) for (let x = 0; x < this.w; x++) this.set(x, this.h - 1 - y, this.get(x, y));
  }
  /** 1px outline around opaque pixels; grows the canvas by 1 on every side */
  outline(c, diagonal) {
    const src = new Img(this.w + 2, this.h + 2); src.blit(this, 1, 1);
    const op = (x, y) => src.get(x, y) !== T;
    return src.map(src.w, src.h, (x, y) => {
      if (op(x, y)) return src.get(x, y);
      const hit = op(x - 1, y) || op(x + 1, y) || op(x, y - 1) || op(x, y + 1) ||
        (diagonal && (op(x - 1, y - 1) || op(x + 1, y - 1) || op(x - 1, y + 1) || op(x + 1, y + 1)));
      return hit ? c : T;
    });
  }
  crop() {
    let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) if (this.get(x, y) !== T) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = y; }
    return x1 < 0 ? this.copy() : this.map(x1 - x0 + 1, y1 - y0 + 1, (x, y) => this.get(x0 + x, y0 + y));
  }
}

// ---------------------------------------------------------------- drawing
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const bayer = (x, y) => (BAYER[(((y % 4) + 4) % 4) * 4 + (((x % 4) + 4) % 4)] + 0.5) / 16;
const gridRows = (s) => { const r = String(s).replace(/\r/g, '').split('\n').map((l) => l.trim()); while (r.length && !r[0]) r.shift(); while (r.length && !r[r.length - 1]) r.pop(); return r; };
function inPoly(p) {
  const n = p.length / 2;
  return (px, py) => {
    const x = px + 0.5, y = py + 0.5; let inside = false;
    for (let i = 0, j = n - 1; i < n; j = i++) { const xi = p[2 * i], yi = p[2 * i + 1], xj = p[2 * j], yj = p[2 * j + 1]; if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside; }
    return inside;
  };
}
function regionPred(r) {
  if (r.length === 3) { const [cx, cy, rad] = r, rr = (rad + 0.5) ** 2; return (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= rr; }
  if (r.length === 4) { const [x0, y0, w, h] = r; return (x, y) => x >= x0 && y >= y0 && x < x0 + w && y < y0 + h; }
  if (r.length >= 6 && r.length % 2 === 0) return inPoly(r);
  throw new Error('clip region must be [cx,cy,r], [x,y,w,h] or a polygon');
}

/** The object handed to function items: c => c.px(0, 0, "r"). Same method names as pxl. */
class Canvas {
  constructor(img, pal) { this.img = img; this.pal = pal; this.w = img.w; this.h = img.h; }
  plot(x, y, c) { if (c !== null && (!this.clipPred || this.clipPred(Math.floor(x), Math.floor(y)))) this.img.set(x, y, c); }
  color(c) { return this.pal.resolve(c); }
  get(x, y) { return this.img.get(x, y); }
  px(x, y, c) { this.plot(x, y, this.color(c)); }
  rect(x, y, w, h, c) { const k = this.color(c); for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.plot(xx, yy, k); }
  box(x, y, w, h, c) {
    const k = this.color(c);
    for (let xx = x; xx < x + w; xx++) { this.plot(xx, y, k); this.plot(xx, y + h - 1, k); }
    for (let yy = y + 1; yy < y + h - 1; yy++) { this.plot(x, yy, k); this.plot(x + w - 1, yy, k); }
  }
  hline(x, y, len, c) { this.rect(x, y, len, 1, c); }
  vline(x, y, len, c) { this.rect(x, y, 1, len, c); }
  /** Bresenham; width > 1 uses a round brush */
  line(x0, y0, x1, y1, c, width = 1) {
    const k = this.color(c), brush = [];
    if (width > 1) {
      const f = width % 2 === 0 ? 0.5 : 0, r2 = (width / 2) ** 2, lo = -Math.floor((width - 1) / 2), hi = Math.ceil((width - 1) / 2);
      for (let oy = lo; oy <= hi; oy++) for (let ox = lo; ox <= hi; ox++) if ((ox - f) ** 2 + (oy - f) ** 2 <= r2) brush.push(ox, oy);
    } else brush.push(0, 0);
    [x0, y0, x1, y1] = [x0, y0, x1, y1].map(Math.floor);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    for (let err = dx + dy; ;) {
      for (let i = 0; i < brush.length; i += 2) this.plot(x0 + brush[i], y0 + brush[i + 1], k);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }
  ellipse(cx, cy, rx, ry, c, ring = false) {
    const k = this.color(c), ax = rx + 0.5, ay = ry + 0.5, inside = (x, y) => (x / ax) ** 2 + (y / ay) ** 2 <= 1;
    for (let y = -ry; y <= ry; y++) for (let x = -rx; x <= rx; x++)
      if (inside(x, y) && (!ring || !(inside(x - 1, y) && inside(x + 1, y) && inside(x, y - 1) && inside(x, y + 1)))) this.plot(cx + x, cy + y, k);
  }
  circ(cx, cy, r, c) { this.ellipse(cx, cy, r, r, c); }
  ring(cx, cy, r, c) { this.ellipse(cx, cy, r, r, c, true); }
  poly(p, c) {
    if (!Array.isArray(p) || p.length < 6 || p.length % 2) throw new Error('poly needs [x0,y0, x1,y1, x2,y2, ...]');
    const k = this.color(c), inside = inPoly(p), xs = p.filter((_, i) => i % 2 === 0), ys = p.filter((_, i) => i % 2);
    for (let y = Math.floor(Math.min(...ys)); y < Math.ceil(Math.max(...ys)); y++)
      for (let x = Math.floor(Math.min(...xs)); x < Math.ceil(Math.max(...xs)); x++) if (inside(x, y)) this.plot(x, y, k);
  }
  /** 4-connected flood fill */
  fill(x, y, c) {
    const k = this.color(c), img = this.img, sx = Math.floor(x), sy = Math.floor(y);
    if (k === null || !img.inside(sx, sy)) return;
    const target = img.get(sx, sy);
    if (target === k) return;
    const seen = new Uint8Array(img.w * img.h), stack = [sx, sy];
    while (stack.length) {
      const py = stack.pop(), px = stack.pop();
      if (!img.inside(px, py)) continue;
      const i = py * img.w + px;
      if (seen[i] || img.data[i] !== target) continue;
      seen[i] = 1; this.plot(px, py, k);
      stack.push(px + 1, py, px - 1, py, px, py + 1, px, py - 1);
    }
  }
  /** ordered dither: c2 covers `density` of the area */
  dither(x, y, w, h, c1, c2, density = 0.5) {
    const a = this.color(c1), b = this.color(c2);
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.plot(xx, yy, bayer(xx, yy) < density ? b : a);
  }
  /** "." keeps, "_" erases */
  grid(x, y, s) { gridRows(s).forEach((row, r) => [...row].forEach((ch, i) => { if (ch !== '.' && ch !== ' ') this.plot(x + i, y + r, this.color(ch)); })); }
}
const OPS = ['px', 'rect', 'box', 'hline', 'vline', 'line', 'ellipse', 'circ', 'ring', 'poly', 'fill', 'dither', 'grid'];
const UNSUPPORTED = ['anim', 'frame', 'scene', 'layer', 'stamp', 'tile', 'pattern', 'tilemap', 'scatter', 'group', 'text', 'wire', 'grad', 'noise', 'shade', 'light', 'recolor', 'ramps', 'lighting', 'glow', 'lamp', 'include'];

// ---------------------------------------------------------------- project
const isOp = (v) => v && typeof v === 'object' && v.__op === true;
const isPlain = (v) => v && typeof v === 'object' && !Array.isArray(v) && !isOp(v);
const SPRITE_OPTS = new Set(['w', 'h', 'mx', 'my', 'outline', 'outline8', 'base', 'swap', 'flip', 'rot', 'crop']);

export function load(src, file = 'art.px.js') {
  let pal = Palette.from(BUILTIN.pico8);
  const assets = new Map(), sheets = [], cache = new Map();
  const env = {
    use: (p) => { pal = Array.isArray(p) ? Palette.from(p) : BUILTIN[p] ? Palette.from(BUILTIN[p]) : (() => { throw new Error(`unknown palette '${p}' (pxl-lite has: ${Object.keys(BUILTIN).join(', ')})`); })(); },
    pal: (m) => { pal = pal.extend(m); },
    sprite: (name, ...rest) => {
      if (typeof name !== 'string') throw new Error('sprite("name", { opts }?, ...items)');
      if (assets.has(name)) throw new Error(`sprite '${name}' is defined twice`);
      const opts = isPlain(rest[0]) ? rest.shift() : {};
      for (const k of Object.keys(opts)) if (!SPRITE_OPTS.has(k)) throw new Error(`sprite '${name}': option '${k}' is not in pxl-lite (have: ${[...SPRITE_OPTS].join(', ')})`);
      assets.set(name, { opts, items: rest, pal });
    },
    sheet: (name, entries, opts = {}) => sheets.push({ name, entries, opts }),
    clip: (region, ...items) => ({ __op: true, name: 'clip', args: [region, ...items] }),
  };
  for (const n of OPS) env[n] = (...args) => ({ __op: true, name: n, args });
  for (const n of UNSUPPORTED) env[n] = () => { throw new Error(`${n}() is not in pxl-lite; use crsolver/claude-pxl for it`); };
  vm.runInNewContext(src, env, { filename: file, timeout: 5000 });

  const run = (c, items) => {
    for (const it of items) {
      if (typeof it === 'string') c.grid(0, 0, it);
      else if (typeof it === 'function') it(c);
      else if (isOp(it) && it.name === 'clip') { const prev = c.clipPred, p = regionPred(it.args[0]); c.clipPred = prev ? (x, y) => prev(x, y) && p(x, y) : p; run(c, it.args.slice(1)); c.clipPred = prev; }
      else if (isOp(it)) c[it.name](...it.args);
      else throw new Error(`unexpected item ${JSON.stringify(it)}`);
    }
  };
  const image = (name, stack = []) => {
    if (cache.has(name)) return cache.get(name);
    const def = assets.get(name);
    if (!def) throw new Error(`unknown sprite '${name}' (have: ${[...assets.keys()].join(', ')})`);
    if (stack.includes(name)) throw new Error(`base loop: ${[...stack, name].join(' -> ')}`);
    const { opts: o, pal: p } = def;
    let img;
    if (o.base) img = image(o.base, [...stack, name]).copy();
    else {
      let { w, h } = o;
      if (!w || !h) {
        let gw = 0, gh = 0;
        for (const it of def.items) if (typeof it === 'string') { const r = gridRows(it); gh = Math.max(gh, r.length); for (const l of r) gw = Math.max(gw, [...l].length); }
        if (o.mx) gw = o.mx === 'c' ? 2 * gw - 1 : 2 * gw;
        if (o.my) gh = o.my === 'c' ? 2 * gh - 1 : 2 * gh;
        w ??= gw; h ??= gh;
      }
      if (!(w >= 1 && h >= 1)) throw new Error(`sprite '${name}': no size, give { w, h } or a grid string`);
      img = new Img(w, h);
    }
    try { run(new Canvas(img, p), def.items); } catch (e) { throw new Error(`sprite '${name}': ${e.message}`); }
    if (o.mx) img.mirror('x');
    if (o.my) img.mirror('y');
    if (o.swap) { const m = new Map(); for (const [a, b] of Object.entries(o.swap)) { const x = p.resolve(a), y = p.resolve(b); if (x !== null && y !== null) m.set(x, y); } img = img.map(img.w, img.h, (x, y) => m.get(img.get(x, y)) ?? img.get(x, y)); }
    if (o.flip) img = img.flip(o.flip);
    if (o.rot) img = img.rot(o.rot);
    for (const [k, diag] of [['outline', false], ['outline8', true]]) if (o[k]) { const c = p.resolve(o[k]); if (!c) throw new Error(`outline color must be visible, got '${o[k]}'`); img = img.outline(c, diag); }
    if (o.crop) img = img.crop();
    cache.set(name, img);
    return img;
  };
  const exported = () => [...assets.keys()].filter((n) => !n.startsWith('_'));
  const sheetNames = (s) => {
    const out = [];
    for (const e of s.entries) {
      const re = new RegExp('^' + e.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
      for (const n of e.includes('*') ? exported().filter((n) => re.test(n)) : [e]) if (!out.includes(n)) out.push(n);
    }
    return out;
  };
  return { assets, sheets, image, exported, sheetNames, palOf: (n) => assets.get(n).pal };
}

/** palette-key rows, "." for transparent: the exact-check view agents read */
export function keys(project, name) {
  const img = project.image(name), rev = project.palOf(name).reverse(), rows = [];
  for (let y = 0; y < img.h; y++) { let r = ''; for (let x = 0; x < img.w; x++) { const c = img.data[y * img.w + x]; r += c === T ? '.' : rev.get(c) ?? '?'; } rows.push(r); }
  return rows.join('\n');
}

// ---------------------------------------------------------------- sheets, previews, PNG
export function packSheet(items, cols, pad = 0) {
  if (!items.length) throw new Error('sheet is empty');
  const perRow = cols ?? Math.ceil(Math.sqrt(items.length)), frames = [];
  let x = 0, y = 0, rowH = 0, W = 0;
  items.forEach((it, i) => {
    if (i > 0 && i % perRow === 0) { x = 0; y += rowH + pad; rowH = 0; }
    frames.push({ ...it, x, y }); W = Math.max(W, x + it.img.w); x += it.img.w + pad; rowH = Math.max(rowH, it.img.h);
  });
  const sheet = new Img(W, y + rowH);
  for (const f of frames) sheet.blit(f.img, f.x, f.y);
  return { sheet, frames };
}
export function sheetJson(image, sheet, frames) {
  const out = {};
  for (const f of frames) { const { w, h } = f.img; out[f.name] = { frame: { x: f.x, y: f.y, w, h }, rotated: false, trimmed: false, spriteSourceSize: { x: 0, y: 0, w, h }, sourceSize: { w, h } }; }
  return JSON.stringify({ frames: out, meta: { app: 'pxl-lite', image, format: 'RGBA8888', size: { w: sheet.w, h: sheet.h }, scale: '1' } }, null, 1) + '\n';
}
const LIGHT = pack(0xe4, 0xe4, 0xe4), DARK = pack(0xc8, 0xc8, 0xc8);
export const previewScale = (img, max = 768) => Math.max(1, Math.min(16, Math.floor(max / Math.max(img.w, img.h))));
/** upscale with a checkerboard behind transparency and, at scale >= 6, a pixel grid (every 8th line darker) */
export function preview(img, s = previewScale(img)) {
  return img.map(img.w * s, img.h * s, (x, y) => {
    const sx = Math.floor(x / s), sy = Math.floor(y / s);
    let c = img.data[sy * img.w + sx];
    if (c === T || (c & 255) === 0) c = (sx + sy) % 2 === 0 ? LIGHT : DARK;
    if (s >= 6 && (x % s === 0 || y % s === 0)) c = darken(c, (x % s === 0 && sx % 8 === 0) || (y % s === 0 && sy % 8 === 0) ? 0.45 : 0.18);
    return c;
  });
}
const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
/** RGBA PNG bytes */
export function encodePng(img) {
  const chunk = (type, data) => { const b = Buffer.alloc(12 + data.length); b.writeUInt32BE(data.length, 0); b.write(type, 4, 'ascii'); data.copy(b, 8); b.writeUInt32BE(crc32(b.subarray(4, 8 + data.length)), 8 + data.length); return b; };
  const raw = Buffer.alloc((img.w * 4 + 1) * img.h);
  for (let y = 0, o = 0; y < img.h; y++) { raw[o++] = 0; for (let x = 0; x < img.w; x++) { raw.writeUInt32BE(img.data[y * img.w + x], o); o += 4; } }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(img.w, 0); ihdr.writeUInt32BE(img.h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

export function build(project, out, { previews = true, scale } = {}) {
  const lines = [], write = (p, b) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, b); };
  const prev = (name, img) => { if (!previews) return ''; const s = scale ?? previewScale(img); write(join(out, '_preview', name + '.png'), encodePng(preview(img, s))); return ` @${s}x`; };
  for (const n of project.exported()) { const img = project.image(n); write(join(out, 'sprites', n + '.png'), encodePng(img)); lines.push(`sprite ${n} ${img.w}x${img.h}${prev(n, img)}`); }
  for (const s of project.sheets) {
    const { sheet, frames } = packSheet(project.sheetNames(s).map((name) => ({ name, img: project.image(name) })), s.opts.cols, s.opts.pad);
    write(join(out, s.name + '.png'), encodePng(sheet)); write(join(out, s.name + '.json'), sheetJson(s.name + '.png', sheet, frames));
    lines.push(`sheet ${s.name} ${sheet.w}x${sheet.h} (${frames.length} frames)${prev(s.name, sheet)}`);
  }
  return lines;
}

function cli([cmd, file, ...rest]) {
  const usage = 'usage: node pxl-lite.mjs build <art.px.js> [--out DIR] [--scale N] [--no-preview]\n       node pxl-lite.mjs ascii <art.px.js> <name>\n       node pxl-lite.mjs list  <art.px.js>';
  if (!cmd || !file || cmd === '-h' || cmd === '--help') return console.log(usage);
  const p = load(readFileSync(file, 'utf8'), file);
  if (cmd === 'build') {
    const opt = (f) => { const i = rest.indexOf(f); return i >= 0 ? rest[i + 1] : undefined; };
    const t0 = performance.now(), lines = build(p, opt('--out') ?? 'out', { previews: !rest.includes('--no-preview'), scale: opt('--scale') && +opt('--scale') });
    console.log(lines.join('\n') + `\nbuilt in ${(performance.now() - t0).toFixed(1)} ms -> ${opt('--out') ?? 'out'}/`);
  } else if (cmd === 'ascii') console.log(keys(p, rest[0]));
  else if (cmd === 'list') console.log([...p.assets.keys()].map((n) => `sprite ${n}`).concat(p.sheets.map((s) => `sheet ${s.name}: ${p.sheetNames(s).join(' ')}`)).join('\n'));
  else { console.error(usage); process.exitCode = 1; }
}
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  try { cli(process.argv.slice(2)); } catch (e) { console.error('pxl-lite: ' + e.message); process.exit(1); }
}
