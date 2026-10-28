/**
 * One size in one place in every `tailwind-variants/lite` recipe. The lite build merges no conflicting
 * classes, so where two parts of a recipe that can apply together each set the same size — the base and a
 * variant, two variants, a variant and a compound — the element receives both classes and the stylesheet's
 * order picks the winner, not the recipe. Two values of one variant never apply together, nor two compounds
 * whose conditions name different values of one variant, so neither is reported.
 *
 * A size is a width or a height and their bounds (`size-` setting both), a padding, a margin, a gap, a font
 * size or a line height, under one variant prefix. `px` and `ps` are different properties, and Tailwind
 * orders the longhand after the shorthand, so a `ps-3` beside a `px-2.5` is an override the stylesheet
 * settles the same way every time and is not reported.
 */

const SIZE = /^-?(min-w|max-w|min-h|max-h|size|w|h|p[xytrblse]?|m[xytrblse]?|gap-[xy]|gap|leading)-.+$/;
const FONT_SIZE = /^text-(?:xs|sm|base|lg|xl|[2-9]xl|\[[^\]]*\])$/;

/** A class split into its variant prefix and its utility, the prefix's colons outside brackets alone. */
function split(name) {
  let depth = 0;
  let cut = -1;
  for (let at = 0; at < name.length; at += 1) {
    const char = name[at];
    if (char === "[" || char === "(") depth += 1;
    else if (char === "]" || char === ")") depth -= 1;
    else if (char === ":" && depth === 0) cut = at;
  }
  return { prefix: name.slice(0, cut + 1), utility: name.slice(cut + 1).replace(/^!|!$/g, "") };
}

/** The sizes a class sets, each keyed by its variant prefix: none, one, or a width and a height for `size-`. */
function sizesOf(name) {
  const { prefix, utility } = split(name);
  if (FONT_SIZE.test(utility)) return [`${prefix}text-size`];
  const match = SIZE.exec(utility);
  if (match === null) return [];
  return match[1] === "size" ? [`${prefix}w`, `${prefix}h`] : [`${prefix}${match[1]}`];
}

/** A string literal's text, or a template's with no expression in it; anything else is not read. */
function textOf(node) {
  if (node?.type === "Literal" && typeof node.value === "string") return node.value;
  if (node?.type === "TemplateLiteral" && node.expressions.length === 0) return node.quasis[0].value.cooked;
  return null;
}

const keyOf = (property) => (property.key.type === "Identifier" ? property.key.name : String(property.key.value));

const propertiesOf = (node) => (node?.type === "ObjectExpression" ? node.properties.filter((property) => property.type === "Property") : []);

/** A recipe part's classes per slot: a string is the base slot's, an object names its slots. */
function slotsOf(node) {
  const text = textOf(node);
  if (text !== null) return [{ slot: "base", text, node }];
  return propertiesOf(node).flatMap((property) => {
    const own = textOf(property.value);
    return own === null ? [] : [{ slot: keyOf(property), text: own, node: property.value }];
  });
}

/** The values a compound's condition takes for one variant. */
function valuesOf(node) {
  if (node.type === "ArrayExpression") return new Set(node.elements.map((element) => String(element?.value)));
  return new Set([String(node.value)]);
}

/** Whether two parts' conditions can hold at once: every variant both name shares a value. */
function together(one, other) {
  for (const [variant, values] of one) {
    const others = other.get(variant);
    if (others !== undefined && ![...values].some((value) => others.has(value))) return false;
  }
  return true;
}

const describeWhere = (condition) =>
  condition.size === 0 ? "always" : [...condition].map(([variant, values]) => `${variant}: ${[...values].join(" | ")}`).join(", ");

const recipeSizes = {
  meta: {
    type: "problem",
    docs: { description: "Hold a tailwind-variants/lite recipe to one class per size wherever its parts apply together" },
    messages: {
      twice:
        "`{{first}}` ({{firstWhere}}) and `{{second}}` ({{secondWhere}}) set the same size on the {{slot}} slot and can apply together. tailwind-variants/lite merges no classes, so the stylesheet's order would pick one: state the size in one place.",
    },
    schema: [],
  },
  create(context) {
    const recipes = new Set();
    return {
      ImportDeclaration(node) {
        if (node.source.value !== "tailwind-variants/lite") return;
        for (const specifier of node.specifiers) {
          if (specifier.type === "ImportSpecifier" && specifier.imported.name === "tv") recipes.add(specifier.local.name);
        }
      },
      CallExpression(node) {
        if (node.callee.type !== "Identifier" || !recipes.has(node.callee.name)) return;
        const config = new Map(propertiesOf(node.arguments[0]).map((property) => [keyOf(property), property.value]));

        // Every part of the recipe with the condition under which it applies.
        const parts = [];
        for (const piece of slotsOf(config.get("base"))) parts.push({ ...piece, condition: new Map() });
        for (const piece of slotsOf(config.get("slots"))) parts.push({ ...piece, condition: new Map() });
        for (const variant of propertiesOf(config.get("variants"))) {
          for (const value of propertiesOf(variant.value)) {
            const condition = new Map([[keyOf(variant), new Set([keyOf(value)])]]);
            for (const piece of slotsOf(value.value)) parts.push({ ...piece, condition });
          }
        }
        for (const compound of config.get("compoundVariants")?.elements ?? []) {
          const condition = new Map();
          let classes;
          for (const property of propertiesOf(compound)) {
            const key = keyOf(property);
            if (key === "class" || key === "className") classes = property.value;
            else condition.set(key, valuesOf(property.value));
          }
          for (const piece of slotsOf(classes)) parts.push({ ...piece, condition });
        }

        // Each size a part sets, and where; a part restating one of its own sizes counts too.
        const seen = new Map();
        for (const part of parts) {
          for (const [name, size] of part.text
            .split(/\s+/)
            .filter(Boolean)
            .flatMap((name) => sizesOf(name).map((size) => [name, size]))) {
            const key = `${part.slot}\u0000${size}`;
            const earlier = seen.get(key) ?? [];
            const clash = earlier.find((other) => together(other.condition, part.condition));
            if (clash !== undefined) {
              context.report({
                node: part.node,
                messageId: "twice",
                data: {
                  first: clash.name,
                  firstWhere: describeWhere(clash.condition),
                  second: name,
                  secondWhere: describeWhere(part.condition),
                  slot: part.slot,
                },
              });
            }
            earlier.push({ name, condition: part.condition });
            seen.set(key, earlier);
          }
        }
      },
    };
  },
};

export default recipeSizes;
