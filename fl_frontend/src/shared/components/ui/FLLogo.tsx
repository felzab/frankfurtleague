/**
 * The FL mark, as rendered in the app's chrome.
 *
 * **Generated - do not edit by hand.** Run `node scripts/generate-brand-assets.mjs` from
 * `fl_frontend/`; that script owns the geometry and emits this file alongside the icons, so the
 * header mark and the favicon cannot drift apart. They already did once, by 47px, when these
 * coordinates were transcribed by hand.
 *
 * This is the **clean** rendering - no outline, no print erosion. The component is only ever mounted
 * small (24-34px in the topnav, sidemenu, drawer and footer), where the outline doubles every edge
 * into noise and the speckle reads as dirt. The eroded rendering ships as `apple-icon.png`, the two
 * manifest icons and the Open Graph card.
 *
 * The letters are rectangles rather than `<text>`: the same drawing has to rasterise identically in
 * the browser and in librsvg when the PNGs are built, and librsvg has no Impact.
 *
 * The previous mark was a sphere panelled with stars - UEFA's Champions League device. Replaced on
 * the owner's instruction (2026-08-01).
 */
export function FLLogo({ className = "size-8" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 512 512"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="presentation">
      {/* The tile takes the theme token, not a literal, so it tracks --accent-brand-solid. */}
      <rect
        width="512"
        height="512"
        rx="112"
        className="fill-brand-solid"
      />
      {/* skewX gives the italic; the translate re-centres what the skew pushed left. */}
      <g transform="skewX(-12) translate(52 0)">
        <g fill="#4d0e10">
          <rect
            x="93.72"
            y="152"
            width="61.02"
            height="226"
          />
          <rect
            x="93.72"
            y="152"
            width="167.24"
            height="61.02"
          />
          <rect
            x="93.72"
            y="241.27"
            width="135.6"
            height="61.02"
          />
          <rect
            x="292.6"
            y="152"
            width="61.02"
            height="226"
          />
          <rect
            x="292.6"
            y="316.98"
            width="153.68"
            height="61.02"
          />
        </g>
        <g fill="#ffffff">
          <rect
            x="79.72"
            y="138"
            width="61.02"
            height="226"
          />
          <rect
            x="79.72"
            y="138"
            width="167.24"
            height="61.02"
          />
          <rect
            x="79.72"
            y="227.27"
            width="135.6"
            height="61.02"
          />
          <rect
            x="278.6"
            y="138"
            width="61.02"
            height="226"
          />
          <rect
            x="278.6"
            y="302.98"
            width="153.68"
            height="61.02"
          />
        </g>
      </g>
    </svg>
  );
}
