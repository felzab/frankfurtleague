/**
 * The token file's colours, read as a browser paints them: every token the dark theme declares is a
 * light token too, every Tailwind colour reads a declared token, and each pair a reader meets keeps
 * the WCAG 2.x contrast its job needs, in both themes. A token the dark block leaves out keeps its
 * light value there, as the cascade gives it.
 */

/** Text and the status words need 4.5:1; a control's edge, a focus ring and a mark on the band need 3:1. */
const TEXT = 4.5;
const EDGE = 3;

const GROUNDS = ["bg", "bg-surface", "bg-muted"];

/** [foreground, ground, floor, the job named in the report]. */
const PAIRS = [
  ...["fg", "fg-muted", "brand", "success", "info", "warn", "danger"].flatMap((ink) => GROUNDS.map((ground) => [ink, ground, TEXT, "text"])),
  ["on-brand", "brand-solid", TEXT, "text on the primary button"],
  ["on-brand", "brand-solid-hover", TEXT, "text on the primary button, hovered"],
  ["on-brand", "danger-solid", TEXT, "text on the destructive button"],
  ["on-brand", "danger-solid-hover", TEXT, "text on the destructive button, hovered"],
  ["brand-accent", "brand-solid", EDGE, "the mark on the band"],
  ["border-control", "bg", EDGE, "a control's edge"],
  ["border-control", "bg-surface", EDGE, "a control's edge"],
  ["on-brand", "brand-solid", EDGE, "the focus ring on the band"],
];

/** A status word on its own tint: the hue at this share over the ground, as `bg-{hue}/12` paints it. */
const TINT = 0.12;
const TINTED = ["success", "info", "warn", "danger"].flatMap((hue) => ["bg", "bg-surface"].map((ground) => [hue, ground]));

const HEX = /^#([0-9a-f]{6})$/i;
const VAR = /^var\(\s*--([a-z0-9-]+)\s*\)$/;

const channels = (hex) => [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16) / 255);

const linear = (channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);

const luminance = (rgb) => {
  const [red, green, blue] = rgb.map(linear);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
};

const contrast = (one, other) => {
  const [high, low] = [luminance(one), luminance(other)].sort((a, b) => b - a);
  return (high + 0.05) / (low + 0.05);
};

/** An alpha fill composites per channel on the encoded values, which is how the browser paints it. */
const over = (rgb, share, ground) => rgb.map((channel, index) => channel * share + ground[index] * (1 - share));

/** Floored to two places, so a figure printed never reads as clearing a floor it misses. */
const shown = (ratio) => (Math.floor(ratio * 100) / 100).toFixed(2);

const LIGHT = ":root";
const DARK = '[data-theme="dark"]';

const tokenContrast = {
  meta: {
    type: "problem",
    languages: ["css/css"],
    docs: { description: "Hold the colour tokens to one list and their pairs to WCAG contrast" },
    messages: {
      darkOnly: "The dark theme declares `--{{token}}`, which the light theme does not: every token has a light value.",
      notHex: "`--{{token}}` is not a six-digit hex colour, so its contrast cannot be measured.",
      unbridged: "`--color-{{name}}` reads `--{{token}}`, which no theme declares, so the utility paints nothing.",
      missing: "No theme declares `--{{token}}`, which a measured pair needs.",
      tooLow: "{{theme}}: `{{ink}}` on `{{ground}}` ({{job}}) measures {{ratio}}:1, under {{floor}}:1.",
    },
    schema: [],
  },
  create(context) {
    const { sourceCode } = context;
    const themes = { light: new Map(), dark: new Map() };
    const bridges = [];
    let stylesheet;

    const inMedia = (node) => sourceCode.getAncestors(node).some((ancestor) => ancestor.type === "Atrule" && ancestor.name === "media");

    return {
      StyleSheet(node) {
        stylesheet = node;
      },
      Rule(node) {
        const selector = sourceCode.getText(node.prelude).trim();
        const theme = selector === LIGHT ? themes.light : selector === DARK ? themes.dark : undefined;
        // A `:root` inside a media query holds the motion durations, never a colour.
        if (theme === undefined || inMedia(node)) return;
        for (const declaration of node.block.children) {
          if (declaration.type !== "Declaration" || !declaration.property.startsWith("--")) continue;
          theme.set(declaration.property.slice(2), { value: sourceCode.getText(declaration.value).trim(), node: declaration });
        }
      },
      "Atrule[name='theme'] Declaration"(node) {
        if (!node.property.startsWith("--color-")) return;
        const read = VAR.exec(sourceCode.getText(node.value).trim());
        if (read !== null) bridges.push({ name: node.property.slice("--color-".length), token: read[1], node });
      },
      "StyleSheet:exit"() {
        const report = (node, messageId, data) => context.report({ node: node ?? stylesheet, messageId, data });

        for (const [token, { node }] of themes.dark) if (!themes.light.has(token)) report(node, "darkOnly", { token });
        for (const { name, token, node } of bridges) if (!themes.light.has(token)) report(node, "unbridged", { name, token });

        const measured = new Set([...PAIRS.flatMap(([ink, ground]) => [ink, ground]), ...TINTED.flat()]);
        for (const token of measured) if (!themes.light.has(token)) report(undefined, "missing", { token });

        // Every declaration read once, so a value that is no colour is reported once.
        const colours = new Map();
        for (const theme of [themes.light, themes.dark]) {
          for (const [token, { value, node }] of theme) {
            if (HEX.test(value)) colours.set(node, channels(value));
            else if (measured.has(token)) report(node, "notHex", { token });
          }
        }

        // The dark theme is the light one with its own declarations laid over it.
        const resolved = { light: themes.light, dark: new Map([...themes.light, ...themes.dark]) };
        for (const theme of ["light", "dark"]) {
          const held = (token) => resolved[theme].get(token);
          const rgb = (token) => (held(token) === undefined ? undefined : colours.get(held(token).node));
          const check = (ink, ground, inkRgb, groundRgb, floor, job) => {
            if (inkRgb === undefined || groundRgb === undefined) return;
            const ratio = contrast(inkRgb, groundRgb);
            if (ratio < floor) report(held(ink).node, "tooLow", { theme, ink, ground, job, ratio: shown(ratio), floor: floor.toFixed(1) });
          };
          for (const [ink, ground, floor, job] of PAIRS) check(ink, ground, rgb(ink), rgb(ground), floor, job);
          for (const [hue, ground] of TINTED) {
            const hueRgb = rgb(hue);
            const groundRgb = rgb(ground);
            if (hueRgb !== undefined && groundRgb !== undefined) {
              check(hue, `${hue} at 12 % over ${ground}`, hueRgb, over(hueRgb, TINT, groundRgb), TEXT, "a status word on its tint");
            }
          }
        }
      },
    };
  },
};

export default tokenContrast;
