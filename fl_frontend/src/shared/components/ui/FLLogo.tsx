export function FLLogo({ className = "size-8" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 512 512"
      xmlns="http://www.w3.org/2000/svg"
      className={className}>
      <defs>
        <filter
          id="splash-medium"
          x="-20%"
          y="-20%"
          width="140%"
          height="140%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.25"
            numOctaves={3}
            result="edge-noise"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="edge-noise"
            scale={5}
            xChannelSelector="R"
            yChannelSelector="G"
            result="rough-text"
          />

          <feTurbulence
            type="turbulence"
            baseFrequency="0.03 0.07"
            numOctaves={2}
            result="splash-noise"
          />
          <feColorMatrix
            type="matrix"
            values="
            1 0 0 0 0
            0 1 0 0 0
            0 0 1 0 0
            0 0 0 40 -22"
            in="splash-noise"
            result="splatters"
          />

          <feComposite
            operator="out"
            in="rough-text"
            in2="splatters"
          />
        </filter>
      </defs>

      <rect
        width="512"
        height="512"
        rx={32}
        className="fill-brand-solid"
      />

      <g className="[filter:url(#splash-medium)]">
        <text
          x="31"
          y="55%"
          dominantBaseline="middle"
          textLength="200"
          lengthAdjust="spacingAndGlyphs"
          className="fill-white font-['Impact','Arial_Black',sans-serif] text-[340px] font-black">
          F
        </text>
        <text
          x="287"
          y="55%"
          dominantBaseline="middle"
          textLength="180"
          lengthAdjust="spacingAndGlyphs"
          className="fill-white font-['Impact','Arial_Black',sans-serif] text-[340px] font-black">
          L
        </text>
      </g>
    </svg>
  );
}
