import { useId } from "react";

/**
 * The FL letterform. Rectangles rather than a `<text>` node: the mark must not depend on a font
 * being installed where it renders.
 */
const LETTERFORM = [
  { x: 95.72, y: 154, width: 61.02, height: 226 },
  { x: 95.72, y: 154, width: 167.24, height: 61.02 },
  { x: 95.72, y: 243.27, width: 135.6, height: 61.02 },
  { x: 294.6, y: 154, width: 61.02, height: 226 },
  { x: 294.6, y: 318.98, width: 153.68, height: 61.02 },
] as const;

/**
 * **Subtracted per rectangle rather than applied as a group `transform`**: both filtered groups
 * sample `feTurbulence` in user space, so a translate would carry the noise with the letters and
 * retexture the mark.
 */
const FACE_LIFT = 16;

function Letterform({ lift = 0 }: { lift?: number }) {
  return (
    <>
      {LETTERFORM.map((bar) => (
        <rect
          key={`${String(bar.x)}-${String(bar.y)}-${String(bar.width)}`}
          x={bar.x - lift}
          y={bar.y - lift}
          width={bar.width}
          height={bar.height}
        />
      ))}
    </>
  );
}

export function FLLogo({ className = "size-8" }: { className?: string }) {
  // Unique per instance: `url(#…)` resolves to the first match, so a second logo on the page would
  // silently borrow the first one's filter.
  const filterId = useId();

  return (
    <svg
      viewBox="0 0 512 512"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="presentation">
      <defs>
        {/* Turbulence roughens the outline, then a coarser one is thresholded into specks and punched out of the letters. */}
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

      {/* The tile takes the theme token rather than a literal, so it tracks `--accent-brand-solid`. */}
      <rect
        width="512"
        height="512"
        rx="112"
        className="fill-brand-solid"
      />

      {/* `skewX` gives the italic; the translate re-centres what the skew pushed left. */}
      <g transform="skewX(-12) translate(52 0)">
        <g
          fill="#4d0e10"
          filter={`url(#${filterId})`}>
          <Letterform />
        </g>
        <g
          fill="none"
          stroke="#ffffff"
          strokeWidth="7"
          opacity="0.75">
          <Letterform />
        </g>
        <g
          fill="#ffffff"
          filter={`url(#${filterId})`}>
          <Letterform lift={FACE_LIFT} />
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
