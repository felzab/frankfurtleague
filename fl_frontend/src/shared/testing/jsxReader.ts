import ts from "typescript";

/**
 * One module's syntax tree.
 *
 * Parsed rather than matched as text: the Prettier plugin owns the order inside a class attribute,
 * a reformat moves every offset, and a class named in a comment reads as a class list to a matcher.
 */
export function parseModule(file: string, text: string): ts.SourceFile {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

/**
 * The static halves of a class list, an interpolation contributing a word break rather than tokens.
 *
 * A template's own text counts, so a utility beside a `${…}` hole is still declared; the hole itself
 * is `interpolatedNames`'s.
 */
function classText(node: ts.Node | undefined): string {
  if (node === undefined) return "";
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isJsxExpression(node)) return classText(node.expression);
  if (ts.isTemplateExpression(node)) return [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(" ");

  return "";
}

const tokensOf = (text: string): string[] => text.split(/\s+/).filter((token) => token !== "");

/** One named attribute of an opening tag, or `undefined` where it declares none. */
function attributeNode(opening: ts.JsxOpeningLikeElement, source: ts.SourceFile, name: string): ts.JsxAttribute | undefined {
  const found = opening.attributes.properties.find((property) => ts.isJsxAttribute(property) && property.name.getText(source) === name);

  return found !== undefined && ts.isJsxAttribute(found) ? found : undefined;
}

/** The class attribute's value, however it is spelled — a bare string, an expression, a template. */
function classAttribute(opening: ts.JsxOpeningLikeElement, source: ts.SourceFile): ts.Node | undefined {
  return attributeNode(opening, source, "className")?.initializer;
}

/** A string an attribute carries as a literal, or `null` where its value is anything else. */
export function staticValue(value: ts.Node | undefined): string | null {
  if (value === undefined) return null;
  if (ts.isStringLiteralLike(value)) return value.text;
  if (ts.isJsxExpression(value) && value.expression !== undefined && ts.isStringLiteralLike(value.expression)) return value.expression.text;

  return null;
}

/**
 * The names a class attribute interpolates.
 *
 * A shared inset or a recipe call arrives as one of these, never as a token `classes` can read, so a
 * sweep over tokens alone reports an element wearing it as bare.
 */
function interpolatedNames(opening: ts.JsxOpeningLikeElement, source: ts.SourceFile): string[] {
  const declared = classAttribute(opening, source);
  if (declared === undefined || !ts.isJsxExpression(declared) || declared.expression === undefined) return [];

  const expression = declared.expression;
  if (ts.isIdentifier(expression)) return [expression.text];
  if (!ts.isTemplateExpression(expression)) return [];

  return expression.templateSpans.flatMap((span) => (ts.isIdentifier(span.expression) ? [span.expression.text] : []));
}

export interface JsxRead {
  readonly tag: string;
  /** The tokens the element is written with, an interpolated one absent rather than guessed at. */
  readonly classes: readonly string[];
  readonly interpolated: readonly string[];
  /** Whether anything at all is interpolated into the class list, which is what makes `classes` partial. */
  readonly isClassInterpolated: boolean;
  readonly attributes: ReadonlyMap<string, ts.JsxAttributeValue | undefined>;
  /** One-based, as an editor counts, so a finding names the line a reader jumps to. */
  readonly line: number;
  readonly start: number;
  readonly end: number;
  readonly node: ts.JsxElement | ts.JsxSelfClosingElement;
  /** Its whole source, which is what tells one cell of a row from another. */
  readonly text: string;
  /** Its DIRECT children's source, which is what tells the element carrying a string from the box around it. */
  readonly own: string;
}

const isElement = (node: ts.Node): node is ts.JsxElement | ts.JsxSelfClosingElement =>
  ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node);

/**
 * Every element a module writes, in source order.
 *
 * `text` and `own` are read on access rather than built here: a sweep over the whole tree touches
 * tens of thousands of elements and reads the source of a handful.
 */
export function elementsIn(source: ts.SourceFile): JsxRead[] {
  const found: JsxRead[] = [];

  const visit = (node: ts.Node): void => {
    if (isElement(node)) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node;
      const declared = classAttribute(opening, source);
      const interpolated = interpolatedNames(opening, source);
      const attributes = new Map<string, ts.JsxAttributeValue | undefined>();
      for (const property of opening.attributes.properties) {
        if (ts.isJsxAttribute(property)) attributes.set(property.name.getText(source), property.initializer);
      }

      found.push({
        tag: opening.tagName.getText(source),
        classes: tokensOf(classText(declared)),
        interpolated,
        isClassInterpolated: hasHole(declared),
        attributes,
        line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
        start: node.getStart(source),
        end: node.getEnd(),
        node,
        get text() {
          return node.getText(source);
        },
        get own() {
          return ts.isJsxElement(node) ? node.children.map((child) => child.getText(source)).join("") : "";
        },
      });
    }
    ts.forEachChild(node, visit);
  };

  visit(source);
  return found;
}

/** An expression of any kind, not an identifier alone: a recipe call hides tokens exactly as a constant does. */
function hasHole(node: ts.Node | undefined): boolean {
  if (node === undefined) return false;
  if (ts.isTemplateExpression(node)) return true;
  if (ts.isJsxExpression(node)) return node.expression !== undefined && !ts.isStringLiteralLike(node.expression);

  return false;
}
