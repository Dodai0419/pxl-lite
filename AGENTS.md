# AGENTS.md — pxl-lite

One file, Node 18+, no packages. Write an `art.px.js`, build it, look at the preview, patch, repeat.

## Commands (run from the repo root)
- Build: `node pxl-lite.mjs build art.px.js --out out` (writes `out/sprites/*.png`, `out/<sheet>.png` + `.json`, `out/_preview/*.png`)
- Read exact pixels as palette keys: `node pxl-lite.mjs ascii art.px.js <sprite>`
- List sprites and sheets: `node pxl-lite.mjs list art.px.js`
- Examples: `examples/slime.px.js`, `examples/basics.px.js`, `examples/cabin.px.js`

## The DSL
- `use("pico8" | "sweetie16" | ["#hex", ...])`, then `pal({ k: 0, g: "#8ccf63", h: "g" })`: one-character keys (index, hex, or another key). `.` keeps, `_` erases.
- `sprite(name, { opts }?, ...items)`. Items: text grids (one key per pixel), primitives, `(c) => { c.px(x, y, "r") }`.
- Options: `w`, `h`, `mx` / `my` (`true` doubles the grid, `"c"` shares the center line), `outline`, `outline8`, `base` (start from another sprite), `swap: { g: "r" }`, `flip: "x"|"y"|"xy"`, `rot: 90|180|270`, `crop`.
- Primitives: `px rect box hline vline line(x0,y0,x1,y1,c,width) circ ring ellipse poly([x0,y0,...]) fill dither(x,y,w,h,c1,c2,density) grid(x,y,str) clip(region, ...items)`.
- `sheet(name, ["slime*", "coin"], { cols, pad })`. Names starting with `_` are parts: not exported, but usable as `base`.

## Workflow
1. Write the left half of symmetric sprites and use `mx`; outline last with `outline`.
2. Build, then open the `_preview` PNG (or run `ascii`) and fix specific pixels.
3. Make variants with `base` + `swap` instead of redrawing.
4. Need animation, layers, lighting or tilemaps? Those are in the full crsolver/claude-pxl; say so.
