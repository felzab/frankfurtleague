/**
 * Generates every Frankfurt-League brand asset from one source of truth.
 *
 *   node scripts/generate-brand-assets.mjs        (from fl_frontend/)
 *
 * Committed rather than run once and thrown away, because the mark is parameterised: the erosion is
 * three numbers in `EROSION`, and moving them must not mean reconstructing this file from a
 * screenshot.
 *
 * ── Two renderings of one mark ────────────────────────────────────────────────
 * DISPLAY  — outline + erosion + speed bars. Everything rendered above ~64px.
 * CLEAN    — neither outline nor erosion. The favicon, `icon.svg` and the `FLLogo` component.
 * Below about 32px the outline doubles every edge into noise and the speckle just reads as dirt, so
 * the small sizes get a mark that is the same shape without the print texture.
 *
 * ── Why the letters are rectangles ────────────────────────────────────────────
 * F and L are drawn as geometry, never as <text>. An icon containing text renders differently on
 * every machine that rasterises it, and librsvg — which produces the PNGs below — has no Impact. The
 * Open Graph card is the one exception: it needs the full wordmark, which cannot reasonably be drawn
 * by hand, and it ships as a PNG so the font dependency ends at build time.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const sharp = require("sharp");

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP = join(ROOT, "src", "app");
const PUBLIC = join(ROOT, "public", "icons");

const MAROON = "#82181a"; // --accent-brand-solid
const MAROON_DEEP = "#4d0e10"; // the offset-shadow tone from the Instagram set
const WHITE = "#ffffff";

/** Erosion strength — a deliberate aesthetic choice; move the three numbers together. */
const EROSION = { grain: 0.2, cut: "44 -34", disp: 4 };

/**
 * Impact, not Haettenschweiler. Erosion removes a roughly fixed number of pixels, so a narrower face
 * loses proportionally more of each stroke: side by side at this strength, Haettenschweiler's texture
 * barely registered and the letters went weak. Impact also matches the Instagram wordmark's width.
 */
const WORDMARK_FONT = "Impact, Haettenschweiler, 'Arial Black', sans-serif";

// ─── Letterforms ──────────────────────────────────────────────────────────────
const STEM = 0.27;
const F_W = 0.74;
const F_MID_W = 0.6;
const L_W = 0.68;
const KERN = 0.14;
const pairWidth = (h) => h * F_W + h * KERN + h * L_W;

const glyphF = (x, y, h) => {
  const t = h * STEM;
  return `<rect x="${x}" y="${y}" width="${t}" height="${h}"/><rect x="${x}" y="${y}" width="${h * F_W}" height="${t}"/><rect x="${x}" y="${y + h * 0.395}" width="${h * F_MID_W}" height="${t}"/>`;
};
const glyphL = (x, y, h) => {
  const t = h * STEM;
  return `<rect x="${x}" y="${y}" width="${t}" height="${h}"/><rect x="${x}" y="${y + h - t}" width="${h * L_W}" height="${t}"/>`;
};
const pairFL = (cx, y, h) => {
  const x0 = cx - pairWidth(h) / 2;
  return `${glyphF(x0, y, h)}${glyphL(x0 + h * F_W + h * KERN, y, h)}`;
};

const erosionFilter = (id) =>
  `<filter id="${id}" x="-18%" y="-18%" width="136%" height="136%">` +
  `<feTurbulence type="fractalNoise" baseFrequency="1.4" numOctaves="2" seed="7" result="edge"/>` +
  `<feDisplacementMap in="SourceGraphic" in2="edge" scale="${EROSION.disp}" xChannelSelector="R" yChannelSelector="G" result="rough"/>` +
  `<feTurbulence type="fractalNoise" baseFrequency="${EROSION.grain}" numOctaves="3" seed="3" result="grain"/>` +
  `<feColorMatrix in="grain" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 ${EROSION.cut}" result="speck"/>` +
  `<feComposite operator="out" in="rough" in2="speck"/></filter>`;

const SKEW = "skewX(-12) translate(52 0)";
const H = 226;
const Y = 138;

/**
 * The mark on a 512 canvas.
 *
 * `scale` shrinks the artwork about the centre for the maskable variants: Android crops a maskable
 * icon to a circle at 80% of the canvas, and the speed bars sit low-left, right on that boundary.
 * `rx` is the tile radius — maskable icons must be full-bleed square, because the OS supplies the
 * shape itself and a pre-rounded tile shows background through the corners.
 */
function mark({ display = true, scale = 1, rx = 112 } = {}) {
  const fid = "fl-erode";
  const inner =
    `<g transform="${SKEW}">` +
    (display
      ? `<g fill="${MAROON_DEEP}" filter="url(#${fid})">${pairFL(256 + 16, Y + 16, H)}</g>` +
        `<g fill="none" stroke="${WHITE}" stroke-width="7" opacity="0.75">${pairFL(256 + 16, Y + 16, H)}</g>` +
        `<g fill="${WHITE}" filter="url(#${fid})">${pairFL(256, Y, H)}</g>`
      : `<g fill="${MAROON_DEEP}">${pairFL(256 + 14, Y + 14, H)}</g><g fill="${WHITE}">${pairFL(256, Y, H)}</g>`) +
    `</g>` +
    (display
      ? `<g fill="${WHITE}" opacity="0.55" transform="${SKEW}">` +
        `<rect x="86" y="396" width="164" height="17" rx="8"/><rect x="86" y="424" width="104" height="17" rx="8"/></g>`
      : "");

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">` +
    (display ? `<defs>${erosionFilter(fid)}</defs>` : "") +
    `<rect width="512" height="512" rx="${rx}" fill="${MAROON}"/>` +
    `<g transform="translate(256 256) scale(${scale}) translate(-256 -256)">${inner}</g>` +
    `</svg>`
  );
}

/** 1200×630 Open Graph card, keeping the pitch markings the previous card used. */
function openGraph() {
  const fid = "og-erode";
  const line = `stroke="${WHITE}" stroke-opacity="0.07" stroke-width="3" fill="none"`;
  const markH = 150;
  const markY = 240;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">` +
    `<defs>${erosionFilter(fid)}</defs>` +
    `<rect width="1200" height="630" fill="${MAROON}"/>` +
    `<g ${line}><rect x="150" y="80" width="900" height="470"/><line x1="600" y1="80" x2="600" y2="550"/>` +
    `<circle cx="600" cy="315" r="86"/><rect x="150" y="175" width="122" height="280"/>` +
    `<rect x="150" y="240" width="56" height="150"/><rect x="928" y="175" width="122" height="280"/>` +
    `<rect x="994" y="240" width="56" height="150"/></g>` +
    `<g transform="translate(170 0)"><g transform="skewX(-12) translate(30 0)">` +
    `<g fill="${MAROON_DEEP}" filter="url(#${fid})">${pairFL(300 + 11, markY + 11, markH)}</g>` +
    `<g fill="none" stroke="${WHITE}" stroke-width="5" opacity="0.75">${pairFL(300 + 11, markY + 11, markH)}</g>` +
    `<g fill="${WHITE}" filter="url(#${fid})">${pairFL(300, markY, markH)}</g>` +
    `<g fill="${WHITE}" opacity="0.55"><rect x="212" y="${markY + markH + 26}" width="108" height="11" rx="5"/>` +
    `<rect x="212" y="${markY + markH + 46}" width="68" height="11" rx="5"/></g></g></g>` +
    `<g font-family="${WORDMARK_FONT}">` +
    `<text x="626" y="318" font-size="96" fill="${MAROON_DEEP}" filter="url(#${fid})" letter-spacing="2">FRANKFURT</text>` +
    `<text x="620" y="312" font-size="96" fill="${WHITE}" filter="url(#${fid})" letter-spacing="2">FRANKFURT</text>` +
    `<text x="626" y="408" font-size="96" fill="${MAROON_DEEP}" filter="url(#${fid})" letter-spacing="2">LEAGUE</text>` +
    `<text x="620" y="402" font-size="96" fill="${WHITE}" filter="url(#${fid})" letter-spacing="2">LEAGUE</text>` +
    `<text x="622" y="452" font-size="26" fill="${WHITE}" opacity="0.7" letter-spacing="10" ` +
    `font-family="Segoe UI, Arial, sans-serif" font-weight="700">OBERSTUFENLIGA</text></g></svg>`
  );
}

/**
 * A .ico wrapping PNG frames. sharp cannot write ICO, and the container is trivial: a 6-byte header,
 * one 16-byte directory entry per frame, then the payloads. PNG-in-ICO is understood by every browser
 * still in use.
 */
function ico(frames) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(frames.length, 4);

  let offset = 6 + frames.length * 16;
  const dir = [];
  for (const { size, data } of frames) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2); // palette
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(1, 4); // colour planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    dir.push(e);
  }
  return Buffer.concat([header, ...dir, ...frames.map((f) => f.data)]);
}

// ─── Build ────────────────────────────────────────────────────────────────────
mkdirSync(join(PUBLIC, "manifest"), { recursive: true });
mkdirSync(join(PUBLIC, "opengraph"), { recursive: true });

const displaySvg = Buffer.from(mark({ display: true }));
const cleanSvg = mark({ display: false });
// 0.78 keeps the speed bars inside Android's 80% safe circle.
const maskableSvg = Buffer.from(mark({ display: true, scale: 0.78, rx: 0 }));

const png = (svg, size) => sharp(svg, { density: 384 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer();

writeFileSync(join(APP, "icon.svg"), cleanSvg);

const frames = [];
for (const size of [16, 32, 48]) frames.push({ size, data: await png(Buffer.from(cleanSvg), size) });
writeFileSync(join(APP, "favicon.ico"), ico(frames));

writeFileSync(join(APP, "apple-icon.png"), await png(displaySvg, 180));
// One icon set is full-bleed for the OS to crop, the other is shown as supplied. Why each purpose is
// declared is written where the `purpose` fields are, at `fl_frontend/src/app/manifest.ts :: manifest`.
writeFileSync(join(PUBLIC, "manifest", "manifest-192.png"), await png(maskableSvg, 192));
writeFileSync(join(PUBLIC, "manifest", "manifest-512.png"), await png(maskableSvg, 512));
writeFileSync(join(PUBLIC, "manifest", "icon-192.png"), await png(displaySvg, 192));
writeFileSync(join(PUBLIC, "manifest", "icon-512.png"), await png(displaySvg, 512));
// `flatten` drops an alpha channel this artwork does not use — a full-bleed rectangle rasterises to
// RGBA regardless, and some link-preview renderers mishandle a transparent PNG. Only this asset is
// flattened; the icons need their transparency.
writeFileSync(
  join(PUBLIC, "opengraph", "opengraph.png"),
  await sharp(Buffer.from(openGraph()), { density: 192 })
    .resize(1200, 630)
    .flatten({ background: MAROON })
    .png({ compressionLevel: 9 })
    .toBuffer(),
);

// ─── The React component ──────────────────────────────────────────────────────

// Emitted from the same geometry rather than transcribed. Hand-copying these coordinates once put
// the header mark 47px away from the icons — invisible in isolation, obvious side by side.

// This emits the display rendering: outline, erosion and speed bars, the same mark the app icons
// carry. Only the favicon is clean — the header renders at 32-34 CSS px, and the texture resolves
// well at that density.
function flLogoComponent() {
  const rects = (dx, dy, fill, indent, filter) => {
    const h = H;
    const t = h * STEM;
    const x0 = 256 + dx - pairWidth(h) / 2;
    const y = Y + dy;
    const xL = x0 + h * F_W + h * KERN;
    const pad = " ".repeat(indent);
    const r = (x, yy, w, hh) =>
      `${pad}  <rect x="${+x.toFixed(2)}" y="${+yy.toFixed(2)}" width="${+w.toFixed(2)}" height="${+hh.toFixed(2)}" />`;
    const open = filter
      ? `${pad}<g fill="${fill}" filter={\`url(#\${filterId})\`}>`
      : fill === "none"
        ? `${pad}<g fill="none" stroke="#ffffff" strokeWidth="7" opacity="0.75">`
        : `${pad}<g fill="${fill}">`;
    return [
      open,
      r(x0, y, t, h),
      r(x0, y, h * F_W, t),
      r(x0, y + h * 0.395, h * F_MID_W, t),
      r(xL, y, t, h),
      r(xL, y + h - t, h * L_W, t),
      `${pad}</g>`,
    ].join("\n");
  };

  const BT = String.fromCharCode(96);
  return `import { useId } from "react";

/**
 * **Generated — do not edit by hand.** ${BT}pnpm brand${BT} owns the geometry and emits this beside the icons, so the two cannot
 * drift. The letters are rectangles rather than ${BT}<text>${BT}, librsvg rasterising the PNGs and having no Impact.
 */
export function FLLogo({ className = "size-8" }: { className?: string }) {
  // Unique per instance: ${BT}url(#…)${BT} resolves to the first match, so a second logo on the page would
  // silently borrow the first one's filter.
  const filterId = useId();

  return (
    <svg
      viewBox="0 0 512 512"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="presentation">
      <defs>
        {/* Turbulence roughens the outline, then a coarser one is thresholded into specks and punched out of the
            letters. Change the erosion strength in the generator, not here. */}
        <filter
          id={filterId}
          x="-18%"
          y="-18%"
          width="136%"
          height="136%">
          <feTurbulence type="fractalNoise" baseFrequency="1.4" numOctaves="2" seed="7" result="edge" />
          <feDisplacementMap in="SourceGraphic" in2="edge" scale="${EROSION.disp}" xChannelSelector="R" yChannelSelector="G" result="rough" />
          <feTurbulence type="fractalNoise" baseFrequency="${EROSION.grain}" numOctaves="3" seed="3" result="grain" />
          <feColorMatrix in="grain" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 ${EROSION.cut}" result="speck" />
          <feComposite operator="out" in="rough" in2="speck" />
        </filter>
      </defs>

      {/* The tile takes the theme token rather than a literal, so it tracks ${BT}--accent-brand-solid${BT}. */}
      <rect
        width="512"
        height="512"
        rx="112"
        className="fill-brand-solid"
      />

      {/* ${BT}skewX${BT} gives the italic; the translate re-centres what the skew pushed left. */}
      <g transform="${SKEW}">
${rects(16, 16, MAROON_DEEP, 8, true)}
${rects(16, 16, "none", 8, false)}
${rects(0, 0, WHITE, 8, true)}
      </g>

      {/* The speed bars. */}
      <g
        fill="${WHITE}"
        opacity="0.55"
        transform="${SKEW}">
        <rect x="86" y="396" width="164" height="17" rx="8" />
        <rect x="86" y="424" width="104" height="17" rx="8" />
      </g>
    </svg>
  );
}
`;
}

writeFileSync(join(ROOT, "src", "shared", "components", "ui", "FLLogo.tsx"), flLogoComponent());

console.log("brand assets written:");
console.log("  src/app/icon.svg                        clean");
console.log("  src/app/favicon.ico                     clean, 16/32/48");
console.log("  src/app/apple-icon.png                  display, 180");
console.log("  public/icons/manifest/manifest-192.png  maskable, display");
console.log("  public/icons/manifest/manifest-512.png  maskable, display");
console.log("  public/icons/manifest/icon-192.png      any, display");
console.log("  public/icons/manifest/icon-512.png      any, display");
console.log("  public/icons/opengraph/opengraph.png    1200x630");
console.log("  src/shared/components/ui/FLLogo.tsx     display, generated");
