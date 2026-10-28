// A cabin at night, one 64x40 sprite: dither sky, polygon roof, round-brush smoke, flood fill.
use("sweetie16")
pal({ k: 0, p: 1, r: 2, o: 3, y: 4, G: 5, g: 6, t: 7, n: 8, b: 9, B: 10, c: 11, w: 12, l: 13, s: 14, d: 15 })

sprite("cabin", { w: 64, h: 40 },
  rect(0, 0, 64, 40, "k"),
  dither(0, 0, 64, 14, "k", "n", 0.25), dither(0, 14, 64, 8, "n", "p", 0.5),
  circ(51, 8, 4, "w"), circ(53, 7, 3, "n"),
  (c) => { for (const [x, y] of [[6, 3], [14, 9], [23, 4], [33, 2], [41, 11], [60, 14]]) c.px(x, y, "w") },
  rect(0, 32, 64, 8, "t"), dither(0, 32, 64, 2, "t", "G", 0.5),
  poly([10, 34, 20, 22, 24, 34], "t"), poly([46, 34, 55, 20, 63, 34], "t"),
  rect(22, 21, 22, 13, "o"), box(22, 21, 22, 13, "p"),
  poly([19, 22, 33, 11, 47, 22], "r"), line(19, 22, 33, 11, "p"), line(33, 11, 47, 22, "p"),
  rect(37, 12, 4, 6, "d"), line(39, 10, 42, 4, "s", 2), line(42, 4, 40, 0, "d", 2),
  rect(26, 25, 6, 5, "y"), box(26, 25, 6, 5, "p"), vline(29, 25, 5, "p"), hline(26, 27, 6, "p"),
  rect(35, 25, 5, 9, "p"), px(38, 30, "y"),
  ring(12, 36, 1, "G"), fill(12, 36, "g"))
