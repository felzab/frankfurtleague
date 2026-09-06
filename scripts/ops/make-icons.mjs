import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const USAGE = `usage: node make-icons.mjs --frontend <dir> --faithful <svg> [--simple <svg>]
                          [--out <dir>] [--bg #rrggbb] [--maskable-scale 0.8]
  --out writes every file flat into one directory, for a dry run;
  without it each file lands at its real path under --frontend.`;

// Next.js resolves `favicon.ico` and `apple-icon.png` by their names in the app directory, and
// `app/manifest.ts` names the four manifest icons by URL, so neither set may be renamed or moved.
const LAYOUT = {
  "favicon.ico": "src/app",
  "apple-icon.png": "src/app",
  "icon-192.png": "public/icons/manifest",
  "icon-512.png": "public/icons/manifest",
  "manifest-192.png": "public/icons/manifest",
  "manifest-512.png": "public/icons/manifest",
};

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (!key.startsWith("--") || argv[i + 1] === undefined) throw new Error(`${USAGE}\nbad argument: ${key}`);
    out[key.slice(2)] = argv[i + 1];
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
for (const required of ["frontend", "faithful"]) {
  if (!args[required]) throw new Error(`${USAGE}\nmissing --${required}`);
}

const frontend = path.resolve(args.frontend);
const outDir = args.out ? path.resolve(args.out) : null;
const faithfulPath = path.resolve(args.faithful);
const simplePath = args.simple ? path.resolve(args.simple) : faithfulPath;
const maskableScale = Number(args["maskable-scale"] ?? 0.8);
// A NaN or an out-of-range scale would produce a blank or a clipped maskable icon rather than an
// error, and nothing downstream looks at those two files.
if (!(maskableScale > 0 && maskableScale <= 1)) throw new Error(`--maskable-scale must be in (0, 1]`);

// Resolved against the frontend's manifest rather than this file: `sharp` is the frontend's
// dependency and `scripts/` has no node_modules for a walk up from here to find.
const require = createRequire(path.join(frontend, "package.json"));
const sharp = require("sharp");

const faithfulSvg = fs.readFileSync(faithfulPath);
const simpleSvg = fs.readFileSync(simplePath);

const written = [];
function write(name, buffer) {
  const dir = outDir ?? path.join(frontend, LAYOUT[name]);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, buffer); // A Buffer, never a string: a text stream would turn PNG bytes into CRLF.
  written.push([file, buffer.length]);
}

// librsvg rasterises at `density` dpi against the SVG's intrinsic size, so a target larger than
// that size would upscale a small bitmap instead of re-rendering the vector.
async function png(svg, n) {
  const { width } = await sharp(svg).metadata();
  const density = Math.max(72, Math.ceil((72 * n) / width));
  return sharp(svg, { density }).resize(n, n).png({ compressionLevel: 9 }).toBuffer();
}

// A maskable icon is cropped to an unknown shape inscribed in the square, so it needs an opaque
// bleed no crop can reach and the mark held inside the safe circle.
async function maskablePng(svg, n, background) {
  const inner = Math.round(n * maskableScale);
  const mark = await png(svg, inner);
  const pad = Math.round((n - inner) / 2);
  return sharp({ create: { width: n, height: n, channels: 4, background } })
    .composite([{ input: mark, top: pad, left: pad }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

// iOS composites a transparent corner onto black and then applies its own squircle, so the tile's
// rounded corners are filled back in rather than left to show as black notches.
async function applePng(svg, n, background) {
  const mark = await png(svg, n);
  return sharp(mark).flatten({ background }).png({ compressionLevel: 9 }).toBuffer();
}

function tileBackground() {
  if (args.bg) return args.bg;
  const rect = /<rect\b[^>]*\bfill="(#[0-9a-fA-F]{3,8})"/.exec(faithfulSvg.toString("utf8"));
  if (!rect) throw new Error('no <rect fill="#..."> in the faithful SVG; pass --bg');
  return rect[1];
}

// ICO carries no compression flag: a decoder tells PNG from BMP by the payload's own signature,
// which is why every entry here is written PNG-encoded and none has a BITMAPINFOHEADER.
function packIco(entries) {
  const dir = Buffer.alloc(6 + 16 * entries.length);
  dir.writeUInt16LE(0, 0);
  dir.writeUInt16LE(1, 2);
  dir.writeUInt16LE(entries.length, 4);
  let offset = dir.length;
  entries.forEach(([size, data], i) => {
    const at = 6 + 16 * i;
    dir.writeUInt8(size >= 256 ? 0 : size, at); // 0 means 256: the field is one byte.
    dir.writeUInt8(size >= 256 ? 0 : size, at + 1);
    dir.writeUInt8(0, at + 2);
    dir.writeUInt8(0, at + 3);
    dir.writeUInt16LE(1, at + 4);
    dir.writeUInt16LE(32, at + 6);
    dir.writeUInt32LE(data.length, at + 8);
    dir.writeUInt32LE(offset, at + 12);
    offset += data.length;
  });
  return Buffer.concat([dir, ...entries.map(([, data]) => data)]);
}

const background = tileBackground();

// One drawing across all three frames: a browser may scale the 48 frame into a 16-px slot on a 3x
// display, so a faithful 48 would swap the mark as the display changes rather than as the size does.
const ico = packIco([
  [16, await png(simpleSvg, 16)],
  [32, await png(simpleSvg, 32)],
  [48, await png(simpleSvg, 48)],
]);
write("favicon.ico", ico);

write("apple-icon.png", await applePng(faithfulSvg, 180, background));
write("icon-192.png", await png(faithfulSvg, 192));
write("icon-512.png", await png(faithfulSvg, 512));
write("manifest-192.png", await maskablePng(faithfulSvg, 192, background));
write("manifest-512.png", await maskablePng(faithfulSvg, 512, background));

console.log(`faithful   ${faithfulPath}`);
console.log(`simplified ${simplePath}${args.simple ? "" : "  (fallback: no --simple given)"}`);
console.log(`maskable   background ${background}, mark at ${maskableScale}`);
for (const [file, bytes] of written) console.log(`${String(bytes).padStart(7)} bytes  ${file}`);
