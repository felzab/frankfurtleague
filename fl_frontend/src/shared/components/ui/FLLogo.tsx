type TrophyPath = { d: string; evenOdd?: true };

/** Holes are `evenodd` subpaths rather than overlays in a ground colour, so the mark stays transparent through them on any ground. */
const HALF: readonly TrophyPath[] = [
  { d: "M256.5 46L256 46C228.3 46 213.4 65.1 213.4 69L215.1 91.3L222.3 99L219.8 70.3C219.8 66.3 235.2 52.2 256 52.2L256.5 52.2Z" },
  { d: "M231.2 54.2L237.7 54.2L253.5 328.8L251.3 328.8Z" },
  {
    d: "M194.6 65.3L202.5 65.3C206.7 65.3 209.9 67 209.9 70.5L211.4 89.8L196.6 81.7L187.2 78.2Q184.4 77.2 184.4 75.5C184.4 69.8 188.9 65.3 194.6 65.3Z",
  },
  {
    d: "M185.2 82.4C204.5 86.9 230.5 101.2 229.5 125.2L248.8 328.8L240.6 328.8ZM201.1 96C205.9 98.8 208.8 100.4 210.8 107.7C212.7 115 211 117.8 208.2 122.6C203.5 119.8 200.5 118.3 198.6 111C196.6 103.7 198.4 100.8 201.1 96ZM219.3 112.2C223 115.9 223.9 118.1 223.9 125.2C223.9 132.4 223 134.6 219.3 138.2C215.7 134.6 214.8 132.4 214.8 125.2C214.8 118.1 215.7 115.9 219.3 112.2ZM206.2 128.1C210.7 130.7 212.5 132.4 214.3 139.2C216.2 146.1 215.5 148.5 212.9 153C208.4 150.4 206.6 148.6 204.8 141.8C202.9 135 203.6 132.5 206.2 128.1ZM222.7 143.4C226 146.8 226.9 148.8 226.9 155.3C226.9 161.9 226 163.9 222.7 167.2C219.3 163.9 218.5 161.9 218.5 155.3C218.5 148.8 219.3 146.8 222.7 143.4ZM210.9 157.2C215.1 159.6 216.4 161.4 218.1 167.8C219.8 174.3 219.6 176.4 217.2 180.6C213 178.2 211.7 176.4 210 170C208.3 163.5 208.5 161.4 210.9 157.2ZM226 172.6C229.1 175.7 229.6 177.5 229.6 183.6C229.6 189.7 229.1 191.5 226 194.6C222.8 191.5 222.4 189.7 222.4 183.6C222.4 177.5 222.8 175.7 226 172.6ZM216.5 187C220.2 189.3 220.8 191 222.2 197C223.6 202.9 223.8 204.7 221.4 208.4C217.7 206.1 217.1 204.4 215.7 198.5C214.3 192.6 214.1 190.7 216.5 187ZM229.3 199.7C232.2 202.6 232.4 204.3 232.4 209.9C232.4 215.4 232.2 217.1 229.3 220C226.4 217.1 226.2 215.4 226.2 209.9C226.2 204.3 226.4 202.6 229.3 199.7ZM221.4 213.5C224.7 215.7 224.8 217.3 226 222.5C227.1 227.8 227.6 229.4 225.4 232.7C222.2 230.5 222 228.9 220.9 223.6C219.7 218.4 219.2 216.8 221.4 213.5ZM232.1 225.3C234.6 227.9 234.8 229.4 234.8 234.4C234.8 239.4 234.6 240.9 232.1 243.4C229.5 240.9 229.3 239.4 229.3 234.4C229.3 229.4 229.5 227.9 232.1 225.3Z",
    evenOdd: true,
  },
];

/** Drawn once rather than mirrored: each of these straddles the axis, so a mirrored copy would land back on itself. */
const CENTRE: readonly TrophyPath[] = [
  { d: "M252.5 54.2L259.5 54.2L258 328.8L254 328.8Z" },
  {
    d: "M234.2 365.5A21.8 21.8 0 1 0 277.8 365.5A21.8 21.8 0 1 0 234.2 365.5ZM238.8 365.5A17.2 17.2 0 1 0 273.2 365.5A17.2 17.2 0 1 0 238.8 365.5ZM242.3 365.5A13.7 13.7 0 1 0 269.7 365.5A13.7 13.7 0 1 0 242.3 365.5Z",
    evenOdd: true,
  },
  { d: "M243.4 332.8L268.6 332.8L268.6 343.7A25.1 25.1 0 0 0 243.4 343.7Z" },
  {
    d: "M236.2 381.1Q232 394.9 223.8 408.5Q223.8 410 225.3 410Q256 413 286.7 410Q288.2 410 288.2 408.5Q280 394.9 275.8 381.1A25.1 25.1 0 0 1 236.2 381.1Z",
  },
  {
    d: "M219.3 412.3Q256 417.7 292.7 412.3C295.6 412.3 296.6 414.5 296.6 418.2Q296.6 422.4 295.1 422.4Q256 427.9 216.9 422.4Q215.4 422.4 215.4 418.2C215.4 414.5 216.4 412.3 219.3 412.3Z",
  },
  {
    d: "M210.9 425.1Q256 428.9 301.1 425.1C303.5 425.1 304.5 427.4 304.5 430.1L304.5 432.6Q304.5 433.8 303.3 433.8L208.7 433.8Q207.5 433.8 207.5 432.6L207.5 430.1C207.5 427.4 208.5 425.1 210.9 425.1Z",
  },
  {
    d: "M203.7 437.8L308 437.8Q310.5 437.8 310.5 440.2L310.5 463.5Q310.5 466 308 466L203.7 466Q201.3 466 201.3 463.5L201.3 440.2Q201.3 437.8 203.7 437.8Z",
  },
];

function Paths({ paths }: { paths: readonly TrophyPath[] }) {
  return (
    <>
      {paths.map((path) => (
        <path
          key={path.d}
          d={path.d}
          fillRule={path.evenOdd ? "evenodd" : undefined}
        />
      ))}
    </>
  );
}

/**
 * The `viewBox` is the drawing's own tall bounds, so a square utility such as `size-8` centres the mark in a box of
 * dead width: a caller sizes it by height instead.
 */
export function FLLogo({ className = "h-8 w-auto" }: { className?: string }) {
  return (
    // `fill-current`, so the ground decides: the navbar sits on the page and takes the dark green,
    // while the hero sits on that same green and needs the light one. A baked fill is invisible on
    // one of them.
    <svg
      viewBox="184.4 46 143.1 420"
      xmlns="http://www.w3.org/2000/svg"
      className={`fill-current ${className}`}
      role="presentation">
      <Paths paths={HALF} />

      {/* 512, not this `viewBox`'s width: the coordinates are a 512 tile's, so the mirror axis is x = 256. The half
          overlaps that axis by half a unit, or a seam shows down the middle. */}
      <g transform="matrix(-1 0 0 1 512 0)">
        <Paths paths={HALF} />
      </g>

      <Paths paths={CENTRE} />
    </svg>
  );
}
