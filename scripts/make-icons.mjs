// Generates the extension icons as PNG files without any dependencies.
//
//   node scripts/make-icons.mjs [--design syringe|ring] [--preview <file.png>]
//
// Design "syringe" (default): a syringe filled with red liquid, a dark red play triangle in it, and a pause
// badge on top: pausing the habit. It has too much detail for the toolbar, so the 16 and 32 px icons show a
// red capsule with the pause bars inside it instead.
// Design "ring" (the fallback, should a store review object to the syringe): a pause symbol in a progress ring.
//
// Everything is drawn in a 128-unit design space whose artwork sits in the middle 96 units. The 128 px icon keeps
// that 16 px of transparent padding, as the Chrome Web Store asks; the smaller icons are cropped to the artwork.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { encodePng } from './lib/png.mjs';

const args = process.argv.slice(2);
const design = args.includes('--design') ? args[args.indexOf('--design') + 1] : 'syringe';
const previewFile = args.includes('--preview') ? args[args.indexOf('--preview') + 1] : null;
if (design !== 'syringe' && design !== 'ring') {
  console.error(`unknown design "${design}" (syringe or ring)`);
  process.exit(1);
}
const outDir = path.join(process.cwd(), 'public', 'icons');

// ---- shapes: functions (x, y) -> inside? in design units ----------------------------------------------------

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const rgb = (hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];

/** Rectangle with rounded corners. */
function rect(x0, y0, x1, y1, r = 0) {
  return (x, y) => {
    if (x < x0 || x > x1 || y < y0 || y > y1) return false;
    const cx = clamp(x, x0 + r, x1 - r);
    const cy = clamp(y, y0 + r, y1 - r);
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  };
}
function circle(cx, cy, r) {
  return (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}
function triangle(ax, ay, bx, by, cx, cy) {
  const side = (px, py, qx, qy, x, y) => (x - qx) * (py - qy) - (px - qx) * (y - qy);
  return (x, y) => {
    const d1 = side(ax, ay, bx, by, x, y);
    const d2 = side(bx, by, cx, cy, x, y);
    const d3 = side(cx, cy, ax, ay, x, y);
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
  };
}
/** Part of a ring: between two radii, within `sweep` degrees clockwise from 12 o'clock. Round ends. */
function arc(cx, cy, r, width, sweep) {
  const end = ((sweep - 90) * Math.PI) / 180;
  const cap0 = circle(cx, cy - r, width / 2);
  const cap1 = circle(cx + r * Math.cos(end), cy + r * Math.sin(end), width / 2);
  return (x, y) => {
    if (cap0(x, y) || cap1(x, y)) return true;
    const d = Math.hypot(x - cx, y - cy);
    if (Math.abs(d - r) > width / 2) return false;
    const a = (Math.atan2(y - cy, x - cx) * 180) / Math.PI + 90; // 0 at 12 o'clock, clockwise
    return ((a % 360) + 360) % 360 <= sweep;
  };
}
/** The shape, rotated by `deg` (clockwise on screen) around (ox, oy). */
function rotated(deg, ox, oy, shape) {
  const t = (-deg * Math.PI) / 180;
  const cos = Math.cos(t);
  const sin = Math.sin(t);
  return (x, y) => shape(ox + (x - ox) * cos - (y - oy) * sin, oy + (x - ox) * sin + (y - oy) * cos);
}

// ---- designs: layers from top to bottom, each [shape, colour] ---------------------------------------------

const NAVY = '#0F172A';
const WHITE = '#FFFFFF';
const STEEL = '#CBD5E1';
const RED = '#DC2626';
/** The tile: navy with a slightly lighter rim, so that it does not dissolve into a dark toolbar. */
const BACKGROUND = [
  [rect(18, 18, 110, 110, 20), NAVY],
  [rect(16, 16, 112, 112, 22), '#3B4A63'],
];

/** The full artwork, for 48 px and up. */
function syringe() {
  const tilt = (shape) => rotated(-38, 60, 60, shape);
  return [
    // pause badge, bottom right
    [rect(80, 78, 86, 98, 2), NAVY],
    [rect(90, 78, 96, 98, 2), NAVY],
    [circle(88, 88, 18), WHITE],
    [circle(88, 88, 22), NAVY],
    // syringe, from needle (bottom left) to thumb rest (top right)
    [tilt(triangle(50, 54, 62, 60, 50, 66)), '#7F1D1D'],
    [tilt(rect(73, 49, 78, 71, 1.5)), '#475569'],
    [tilt(rect(39, 49, 73, 71, 3)), RED],
    [tilt(rect(36, 46, 84, 74, 5)), '#F8FAFC'],
    [tilt(rect(29, 55, 36, 65, 2)), STEEL],
    [tilt(rect(12, 58.5, 31, 61.5, 1.5)), STEEL],
    [tilt(rect(83, 40, 88, 80, 2.5)), STEEL],
    [tilt(rect(88, 57, 102, 63)), STEEL],
    [tilt(rect(101, 48, 106, 72, 2.5)), STEEL],
    ...BACKGROUND,
  ];
}

/** The toolbar version: the red capsule with the pause bars turned to sit inside it. */
function capsule() {
  const tilt = (shape) => rotated(-38, 64, 64, shape);
  return [
    [tilt(rect(47, 49, 59, 79, 3)), WHITE],
    [tilt(rect(69, 49, 81, 79, 3)), WHITE],
    [tilt(rect(22, 41, 106, 87, 23)), RED],
    ...BACKGROUND,
  ];
}

/** Fallback design: pause bars inside a three-quarter progress ring. */
function ring(bold) {
  const w = bold ? 13 : 9;
  return [
    [rect(bold ? 49 : 52, 49, bold ? 60 : 60, 79, 3), WHITE],
    [rect(bold ? 68 : 68, 49, bold ? 79 : 76, 79, 3), WHITE],
    [arc(64, 64, 30, w, 270), '#2DD4BF'],
    [arc(64, 64, 30, w, 360), '#1E3A4A'],
    ...BACKGROUND,
  ];
}

function layersFor(size) {
  if (design === 'ring') return ring(size <= 32);
  return size <= 32 ? capsule() : syringe();
}

// ---- rasteriser ---------------------------------------------------------------------------------------------

/** Renders `layers` at `size` px. `padded` keeps the 16-unit transparent border; otherwise the artwork fills the canvas. */
function render(size, layers, padded) {
  const ss = 6; // supersampling per axis
  const origin = padded ? 0 : 16;
  const span = padded ? 128 : 96;
  const rgba = Buffer.alloc(size * size * 4);
  const colours = layers.map(([, c]) => rgb(c));
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, hits = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const x = origin + ((px + (sx + 0.5) / ss) / size) * span;
          const y = origin + ((py + (sy + 0.5) / ss) / size) * span;
          const top = layers.findIndex(([shape]) => shape(x, y));
          if (top < 0) continue;
          hits++;
          r += colours[top][0];
          g += colours[top][1];
          b += colours[top][2];
        }
      }
      if (hits === 0) continue;
      const i = (py * size + px) * 4;
      rgba[i] = Math.round(r / hits);
      rgba[i + 1] = Math.round(g / hits);
      rgba[i + 2] = Math.round(b / hits);
      rgba[i + 3] = Math.round((hits / (ss * ss)) * 255);
    }
  }
  return rgba;
}

/** The icon sizes of the extension: only the 128 px one keeps the padding. */
const ICONS = [
  { size: 16, padded: false },
  { size: 32, padded: false },
  { size: 48, padded: false },
  { size: 128, padded: true },
];

await mkdir(outDir, { recursive: true });
const rendered = [];
for (const { size, padded } of ICONS) {
  const rgba = render(size, layersFor(size), padded);
  rendered.push({ size, rgba });
  await writeFile(path.join(outDir, `icon${size}.png`), encodePng(size, size, rgba));
}
console.log(`icons (${design}) written to ${outDir}: ${ICONS.map((i) => `icon${i.size}.png`).join(', ')}`);

// ---- preview sheet: every size, enlarged, on a light and a dark toolbar colour ----------------------------
if (previewFile) {
  const scale = { 16: 6, 32: 4, 48: 3, 128: 1 };
  const gap = 24;
  const cell = rendered.map(({ size }) => size * scale[size]);
  const width = gap + cell.reduce((a, c) => a + c + gap, 0);
  const rowH = Math.max(...cell) + gap * 2;
  const sheet = Buffer.alloc(width * rowH * 2 * 4);
  const paper = [rgb('#F1F3F4'), rgb('#202124')];
  for (let row = 0; row < 2; row++) {
    for (let y = 0; y < rowH; y++) {
      for (let x = 0; x < width; x++) {
        const i = ((row * rowH + y) * width + x) * 4;
        sheet[i] = paper[row][0];
        sheet[i + 1] = paper[row][1];
        sheet[i + 2] = paper[row][2];
        sheet[i + 3] = 255;
      }
    }
    let x0 = gap;
    rendered.forEach(({ size, rgba }, n) => {
      const k = scale[size];
      const y0 = row * rowH + Math.floor((rowH - cell[n]) / 2);
      for (let y = 0; y < size * k; y++) {
        for (let x = 0; x < size * k; x++) {
          const s = (Math.floor(y / k) * size + Math.floor(x / k)) * 4;
          const a = rgba[s + 3] / 255;
          const i = ((y0 + y) * width + x0 + x) * 4;
          for (let c = 0; c < 3; c++) sheet[i + c] = Math.round(rgba[s + c] * a + sheet[i + c] * (1 - a));
        }
      }
      x0 += cell[n] + gap;
    });
  }
  await mkdir(path.dirname(path.resolve(previewFile)), { recursive: true });
  await writeFile(previewFile, encodePng(width, rowH * 2, sheet));
  console.log(`preview written to ${previewFile} (16 px x6, 32 px x4, 48 px x3, 128 px x1; light and dark toolbar)`);
}
