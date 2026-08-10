import { useId } from "react";

/**
 * The FL mark, as rendered in the app's chrome.
 *
 * **Generated - do not edit by hand.** Run `pnpm brand` from `fl_frontend/`; that script owns the
 * geometry and emits this file alongside the icons, so the header mark and the app icons cannot drift
 * apart.
 *
 * This is the full mark - offset shadow, outline and print erosion - matching `apple-icon.png`, the
 * manifest icons and the Open Graph card. **Only the favicon is clean**, because at 16px the outline
 * doubles every edge into noise; the header renders at 32-34 CSS px, which is 64-68 device pixels,
 * and the texture resolves fine there.
 *
 * The letters are rectangles rather than `<text>`: the same drawing has to rasterise identically in
 * the browser and in librsvg when the PNGs are built, and librsvg has no Impact.
 */
export function FLLogo({ className = "size-8" }: { className?: string }) {
  // The filter id must be unique per instance: more than one logo can share a page, duplicate ids
  // are invalid, and `url(#…)` resolves to the first match - so every later logo would silently
  // borrow the first one's filter.
  const filterId = useId();

  return (
    <svg
      viewBox="0 0 512 512"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="presentation">
      <defs>
        {/* Two passes: turbulence roughens the outline, then a second, coarser turbulence is
            thresholded into specks and punched out of the letters. The three numbers below are the
            erosion strength - change them in the generator, not here. */}
        <filter
          id={filterId}
          x="-18%"
          y="-18%"
          width="136%"
          height="136%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="1.4"
            numOctaves="2"
            seed="7"
            result="edge"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="edge"
            scale="4"
            xChannelSelector="R"
            yChannelSelector="G"
            result="rough"
          />
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.2"
            numOctaves="3"
            seed="3"
            result="grain"
          />
          <feColorMatrix
            in="grain"
            type="matrix"
            values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 44 -34"
            result="speck"
          />
          <feComposite
            operator="out"
            in="rough"
            in2="speck"
          />
        </filter>
      </defs>

      {/* The tile takes the theme token, not a literal, so it tracks --accent-brand-solid. */}
      <rect
        width="512"
        height="512"
        rx="112"
        className="fill-brand-solid"
      />

      {/* skewX gives the italic; the translate re-centres what the skew pushed left. */}
      <g transform="skewX(-12) translate(52 0)">
        <g
          fill="#4d0e10"
          filter={`url(#${filterId})`}>
          <rect
            x="95.72"
            y="154"
            width="61.02"
            height="226"
          />
          <rect
            x="95.72"
            y="154"
            width="167.24"
            height="61.02"
          />
          <rect
            x="95.72"
            y="243.27"
            width="135.6"
            height="61.02"
          />
          <rect
            x="294.6"
            y="154"
            width="61.02"
            height="226"
          />
          <rect
            x="294.6"
            y="318.98"
            width="153.68"
            height="61.02"
          />
        </g>
        <g
          fill="none"
          stroke="#ffffff"
          strokeWidth="7"
          opacity="0.75">
          <rect
            x="95.72"
            y="154"
            width="61.02"
            height="226"
          />
          <rect
            x="95.72"
            y="154"
            width="167.24"
            height="61.02"
          />
          <rect
            x="95.72"
            y="243.27"
            width="135.6"
            height="61.02"
          />
          <rect
            x="294.6"
            y="154"
            width="61.02"
            height="226"
          />
          <rect
            x="294.6"
            y="318.98"
            width="153.68"
            height="61.02"
          />
        </g>
        <g
          fill="#ffffff"
          filter={`url(#${filterId})`}>
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

      {/* The speed bars. */}
      <g
        fill="#ffffff"
        opacity="0.55"
        transform="skewX(-12) translate(52 0)">
        <rect
          x="86"
          y="396"
          width="164"
          height="17"
          rx="8"
        />
        <rect
          x="86"
          y="424"
          width="104"
          height="17"
          rx="8"
        />
      </g>
    </svg>
  );
}
