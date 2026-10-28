import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { encodePng, Img, keys, load, packSheet, sheetJson } from '../pxl-lite.mjs';

// Cases and expected outputs copied from crsolver/claude-pxl test/core.test.ts (same PAL prelude).
const PAL = 'use("pico8"); pal({ k: 0, r: 8, w: 7, g: 11 }); ';
const art = (src, name) => keys(load(PAL + src), name);
const eq = (a, b) => assert.equal(a, b);

test('grid: trimmed rows, short rows padded', () => eq(art('sprite("a", `\n    rr\n    r\n`)', 'a'), 'rr\nr.'));

test('mirror even, odd and vertical', () => {
  eq(art('sprite("a", { mx: true }, "rw")', 'a'), 'rwwr');
  eq(art('sprite("a", { mx: "c", my: "c" }, "r.\\n.w")', 'a'), 'r.r\n.w.\nr.r');
});

test('outline grows the canvas; outline8 adds diagonals', () => {
  eq(art('sprite("a", { outline: "k" }, "r")', 'a'), '.k.\nkrk\n.k.');
  eq(art('sprite("a", { outline8: "k" }, "r")', 'a'), 'kkk\nkrk\nkkk');
});

test('variants: swap, flip, rot', () => {
  const base = 'sprite("a", "rw\\nr.");';
  eq(art(base + 'sprite("b", { base: "a", swap: { r: "g" } })', 'b'), 'gw\ng.');
  eq(art(base + 'sprite("b", { base: "a", flip: "x" })', 'b'), 'wr\n.r');
  eq(art(base + 'sprite("b", { base: "a", rot: 90 })', 'b'), 'rr\n.w');
});

test("overlay keeps with '.', erases with '_'", () => eq(art('sprite("a", "rrr"); sprite("b", { base: "a" }, "._w")', 'b'), 'r.w'));

test('primitives', () => {
  eq(art('sprite("a", { w: 4, h: 3 }, box(0, 0, 4, 3, "r"))', 'a'), 'rrrr\nr..r\nrrrr');
  eq(art('sprite("a", { w: 4, h: 4 }, line(0, 0, 3, 3, "r"))', 'a'), 'r...\n.r..\n..r.\n...r');
  eq(art('sprite("a", { w: 5, h: 3 }, line(1, 1, 3, 1, "r", 3))', 'a'), 'rrrrr\nrrrrr\nrrrrr');
  eq(art('sprite("a", { w: 5, h: 5 }, circ(2, 2, 2, "r"))', 'a'), '.rrr.\nrrrrr\nrrrrr\nrrrrr\n.rrr.');
  eq(art('sprite("a", { w: 5, h: 5 }, ring(2, 2, 2, "r"))', 'a'), '.rrr.\nr...r\nr...r\nr...r\n.rrr.');
  eq(art('sprite("a", { w: 4, h: 2 }, dither(0, 0, 4, 2, "r", "w"))', 'a'), 'wrwr\nrwrw');
  eq(art('sprite("a", "r.r\\nrrr", fill(1, 0, "w"))', 'a'), 'rwr\nrrr');
  eq(art('sprite("a", { w: 4, h: 4 }, poly([0, 0, 4, 0, 0, 4], "r"))', 'a'), 'rrr.\nrr..\nr...\n....');
});

test('clip restricts an op to a region', () => eq(art('sprite("a", { w: 5, h: 3 }, clip([0, 0, 5, 2], circ(2, 2, 2, "r")))', 'a'), '.rrr.\nrrrrr\n.....'));

test('function items get the canvas', () => eq(art('sprite("a", { w: 3, h: 1 }, (c) => { for (let x = 0; x < 3; x += 2) c.px(x, 0, "r") })', 'a'), 'r.r'));

test('sheets expand globs over exported names only', () => {
  const p = load(PAL + 'sprite("s1", "rr"); sprite("s2", "r"); sprite("_x", "r"); sheet("sh", ["s*", "_x"], { pad: 1 })');
  assert.deepEqual(p.sheetNames(p.sheets[0]), ['s1', 's2', '_x']);
});

test('README quick-start slime: mirror + outline, then a one-line recolor', () => {
  const p = load(readFileSync(new URL('../examples/slime.px.js', import.meta.url), 'utf8'));
  eq(keys(p, 'slime'), ['.....kkkkkk.....', '...kkggggggkk...', '..kggGGggGGggk..', '.kggGwGggGwGggk.', 'kgggkwggggwkgggk', 'kGGGGGGGGGGGGGGk', '.kkkkkkkkkkkkkk.'].join('\n'));
  eq(keys(p, 'slime_red'), keys(p, 'slime').replace(/g/g, 'r').replace(/G/g, 'R'));
  const { sheet, frames } = packSheet(p.sheetNames(p.sheets[0]).map((name) => ({ name, img: p.image(name) })), undefined, 1);
  assert.equal(sheet.w, 16 * 2 + 1); assert.deepEqual(frames.map((f) => [f.name, f.x, f.y]), [['slime', 0, 0], ['slime_red', 17, 0]]);
  const j = JSON.parse(sheetJson('chars.png', sheet, frames));
  assert.deepEqual(j.frames.slime_red.frame, { x: 17, y: 0, w: 16, h: 7 });
});

test('PNG round-trips the pixels', () => {
  const img = new Img(3, 2); img.data.set([0xff0000ff, 0, 0x00ff0080, 0x123456ff, 0xffffffff, 0x000000ff]);
  const png = encodePng(img);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const raw = inflateSync(png.subarray(33 + 8, 33 + 8 + png.readUInt32BE(33)));
  const px = []; for (let y = 0; y < 2; y++) for (let x = 0; x < 3; x++) px.push(raw.readUInt32BE(y * 13 + 1 + x * 4));
  assert.deepEqual(px, [...img.data]);
});

test('errors name the problem', () => {
  assert.throws(() => art('sprite("a", "rz")', 'a'), /unknown color key "z"/);
  assert.throws(() => load(PAL + 'anim("x", {})'), /not in pxl-lite/);
  assert.throws(() => art('sprite("a", { base: "b" }); sprite("b", { base: "a" })', 'a'), /base loop/);
});
