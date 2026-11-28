import "server-only";

import { z } from "zod";

import type { Copy } from "./copy";

/**
 * What the browser's pass holds one box to, as its lane's input states it: whether the box may stay empty, its
 * length, the patterns its text meets one of, and its figure's bounds, with the example its „Format: …“ message
 * names. Plain data, so a server page hands it to the form, which the input's schema never reaches. Each rule is
 * never stricter than the input: where the input takes a value several ways, the box takes the loosest of them.
 */
export type BoxRule = {
  readonly required?: true;
  readonly minLength?: number;
  readonly maxLength?: number;
  /** JSON Schema's patterns, each a source the browser compiles under `u`, as JSON Schema reads one: a text meets one. */
  readonly patterns?: readonly string[];
  /** The least and the greatest figure a person can type, an exclusive bound moved one step inward. */
  readonly min?: number;
  readonly max?: number;
  readonly example?: Copy;
};

/** Every box's rule, by the key the parse keys its issues by, `*` standing for each row of a list. */
export type BoxRules = Readonly<Record<string, BoxRule>>;

/** Every row of a list, in a box's key, as a lane declares its paths: `scorers.*.minute` is each record's minute. */
export const EVERY_ROW = "*";

/**
 * The schemas a value standing here is judged by: past every wrapper, the box's side of a pipe, which a preprocess
 * reads after its transform, and each option of a union.
 */
function judgedBy(schema: z.core.$ZodType): readonly z.core.$ZodType[] {
  const def = (schema as z.core.$ZodTypes)._zod.def;
  switch (def.type) {
    case "optional":
    case "nullable":
    case "default":
    case "prefault":
    case "nonoptional":
    case "readonly":
    case "catch":
      return judgedBy(def.innerType);
    case "pipe":
      return judgedBy((def.in as z.core.$ZodTypes)._zod.def.type === "transform" ? def.out : def.in);
    case "union":
      return def.options.flatMap(judgedBy);
    default:
      return [schema];
  }
}

const isObject = (schema: z.core.$ZodType): schema is z.core.$ZodObject => (schema as z.core.$ZodTypes)._zod.def.type === "object";

const joined = (above: string, name: string) => (above === "" ? name : `${above}.${name}`);

/** Every box an input holds, by its key, with the schemas judging it. */
export type Boxes = ReadonlyMap<string, readonly z.core.$ZodType[]>;

function boxesUnder(schema: z.core.$ZodType, key: string, into: Map<string, z.core.$ZodType[]>): void {
  const judged = judgedBy(schema);
  const records = judged.filter(isObject);
  if (records.length > 0) {
    for (const record of records) {
      for (const [name, field] of Object.entries(record._zod.def.shape)) boxesUnder(field, joined(key, name), into);
    }
    return;
  }
  into.set(key, [...(into.get(key) ?? []), schema]);
  for (const list of judged) {
    const def = (list as z.core.$ZodTypes)._zod.def;
    if (def.type !== "array") continue;
    for (const row of judgedBy(def.element).filter(isObject)) {
      for (const [name, field] of Object.entries(row._zod.def.shape)) boxesUnder(field, `${key}.${EVERY_ROW}.${name}`, into);
    }
  }
}

/**
 * Every box an input holds, by its key, with the schemas judging it: an object's fields, each union's options' among
 * them, and a list as one box, a list of records adding each record's fields for every row, `*` standing for each.
 * An object is no box of its own, its fields being the boxes. It walks the schemas' definitions, as Zod documents for a
 * library inspecting a schema (zod.dev, "For library authors").
 */
export function boxesOf(input: z.core.$ZodType): Boxes {
  const boxes = new Map<string, z.core.$ZodType[]>();
  boxesUnder(input, "", boxes);
  return boxes;
}

/** One side of a value's shape as JSON Schema states it, the keywords a box's rule reads. */
type Shape = {
  type?: string;
  anyOf?: readonly Shape[];
  oneOf?: readonly Shape[];
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
};

/** Each shape a value may take, every union flattened, none of them `null`. */
const shapesOf = (shape: Shape): readonly Shape[] =>
  shape.anyOf !== undefined || shape.oneOf !== undefined
    ? [...(shape.anyOf ?? []), ...(shape.oneOf ?? [])].flatMap(shapesOf)
    : shape.type === "null"
      ? []
      : [shape];

/** A figure's bound a person types at: one an integer's own range sets, which no rule sets, stands for none. */
const typed = (bound: number | undefined): number | undefined =>
  bound !== undefined && Math.abs(bound) < Number.MAX_SAFE_INTEGER ? bound : undefined;

/** The bound every shape sets, the loosest of them, or none where one shape sets none. */
function loosest(bounds: readonly (number | undefined)[], pick: (...values: number[]) => number): number | undefined {
  const set = bounds.filter((bound): bound is number => bound !== undefined);
  return set.length === bounds.length && set.length > 0 ? pick(...set) : undefined;
}

/** A text's or a figure's rules from the shapes its box may hold: every shape a text's, or every shape a figure's. */
function shapeRules(shapes: readonly Shape[]): Omit<BoxRule, "required" | "example"> {
  if (shapes.length === 0) return {};
  if (shapes.every(({ type }) => type === "string")) {
    const patterns = shapes.map(({ pattern }) => pattern);
    const minLength = loosest(
      shapes.map(({ minLength }) => minLength),
      Math.min,
    );
    const maxLength = loosest(
      shapes.map(({ maxLength }) => maxLength),
      Math.max,
    );
    return {
      // A length of one is what any value has: the box's being required says the rest.
      ...(minLength !== undefined && minLength > 1 ? { minLength } : {}),
      ...(maxLength === undefined ? {} : { maxLength }),
      ...(patterns.every((pattern) => pattern !== undefined) ? { patterns: [...new Set(patterns)] } : {}),
    };
  }
  if (shapes.every(({ type }) => type === "integer" || type === "number")) {
    const lower = shapes.map((shape) => typed(shape.exclusiveMinimum === undefined ? shape.minimum : shape.exclusiveMinimum + 1));
    const upper = shapes.map((shape) => typed(shape.exclusiveMaximum === undefined ? shape.maximum : shape.exclusiveMaximum - 1));
    const min = loosest(lower, Math.min);
    const max = loosest(upper, Math.max);
    return { ...(min === undefined ? {} : { min }), ...(max === undefined ? {} : { max }) };
  }
  return {};
}

/** What a box posts while empty: a text box its text, a box read as no value nothing, a choice of several none. */
const EMPTY: readonly unknown[] = ["", null, []];

/**
 * A box's rule, from the schemas judging it, the loosest where several do: required where no empty value passes,
 * whichever a box of its kind posts, and its text's or figure's rules as JSON Schema states them, Zod's own reading
 * of its checks (zod.dev, "JSON Schema"), which reads a preprocess's rule past its transform.
 */
function ruleOf(schemas: readonly z.core.$ZodType[], example: Copy | undefined): BoxRule {
  const [first, ...more] = schemas;
  const judged = first === undefined ? z.never() : more.length === 0 ? first : z.union([first, ...more]);
  const shapes = shapesOf(z.toJSONSchema(judged, { io: "input", unrepresentable: "any" }) as Shape);
  // A switch or a tick always holds one of its two answers, so it is never empty.
  const isToggle = shapes.length > 0 && shapes.every(({ type }) => type === "boolean");
  const required = !isToggle && EMPTY.every((empty) => !z.safeParse(judged, empty).success);
  return {
    ...(required ? { required } : {}),
    ...shapeRules(shapes),
    ...(example === undefined ? {} : { example }),
  };
}

/**
 * Every box's rule an input states, by its key, with the example a box's message names: what the browser's pass judges
 * before anything is sent. A box no rule holds is left out.
 */
export function rulesOf(boxes: Boxes, examples: Readonly<Record<string, Copy | undefined>> = {}): BoxRules {
  return Object.fromEntries(
    [...boxes].flatMap(([key, schemas]) => {
      const rule = ruleOf(schemas, examples[key]);
      return Object.keys(rule).length === 0 ? [] : [[key, rule]];
    }),
  );
}
