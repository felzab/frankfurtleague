/**
 * A test runs our real code and fakes only what our code does not own, so a test file stands in for no module under
 * `fl_frontend/src/` but three kinds: an edge module the options name, which is nothing but its edge; a `"use server"`
 * module, whose functions a client reaches over the network; and a file that is no script, such as an image, whose
 * import Next's loader makes. The rule reads the two doors a test file replaces a module through: Vitest's `vi.mock`
 * and `vi.doMock`, and the two maps of `fl_frontend/src/test-support/authDoubles.ts :: registerAuthDoubles`, whose
 * `core` key names `src/core/<key>.ts` and whose `specifiers` key is a specifier. Whatever the rule cannot read fails,
 * so a new shape is refused rather than waved through.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/** Vite's resolution order for a specifier written without its extension. */
const EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
const SCRIPT = /\.[cm]?[jt]sx?$/;
const HELPER_MODULE = "src/test-support/authDoubles.ts";

/** Each target's `"use server"`, by its path, kept while the file is unchanged. */
const directives = new Map();

/** @type {import("eslint").Rule.RuleModule} */
const noOwnModuleDouble = {
  meta: {
    type: "problem",
    schema: [
      {
        type: "object",
        properties: { edges: { type: "array", items: { type: "string" } } },
        required: ["edges"],
        additionalProperties: false,
      },
    ],
    messages: {
      own: '`{{specifier}}` stands in for fl_frontend/{{module}}, a module of ours: a test runs our code and fakes only the edge beneath it, the backend through `@/test-support/backend`. A test stands in only for an edge module eslint.config.mjs names, a "use server" module as a client calls it, or a file that is no script.',
      unread:
        "The rule cannot read which module this stands in for: name it by a string literal, and spell a `registerAuthDoubles` map out with plain keys.",
      unresolved: "`{{specifier}}` names no file: point the stand-in at the module it means.",
    },
  },

  create(context) {
    const [{ edges }] = context.options;
    const root = context.cwd;
    const relative = (file) => path.relative(root, file).replaceAll("\\", "/");
    const directory = path.dirname(path.resolve(root, context.filename));
    let vi = null;
    let helper = null;

    /** The file a specifier names under `src/`, `null` for a package's, `undefined` for a path naming no file. */
    function resolve(specifier) {
      let base;
      if (specifier.startsWith("@/")) base = path.join(root, "src", specifier.slice(2));
      else if (specifier.startsWith("./") || specifier.startsWith("../")) base = path.resolve(directory, specifier);
      else return null;
      const found = ["", ...EXTENSIONS].map((extension) => base + extension).find((file) => existsSync(file) && statSync(file).isFile());
      return found === undefined ? undefined : relative(found);
    }

    /** Whether the module at `file` opens with `"use server"`, read by the parser this file is linted with. */
    function isServerModule(file) {
      const absolute = path.join(root, file);
      const { mtimeMs } = statSync(absolute);
      const known = directives.get(absolute);
      if (known?.mtimeMs === mtimeMs) return known.server;
      const { parser } = context.languageOptions;
      const source = readFileSync(absolute, "utf8");
      const options = { ecmaVersion: "latest", sourceType: "module", ecmaFeatures: { jsx: file.endsWith("x") }, filePath: absolute };
      const program = typeof parser.parseForESLint === "function" ? parser.parseForESLint(source, options).ast : parser.parse(source, options);
      // The parser marks the leading string statements alone as directives, as Next reads a module's.
      const server = program.body.some((statement) => statement.directive === "use server");
      directives.set(absolute, { mtimeMs, server });
      return server;
    }

    /** Judges one specifier a stand-in replaces. */
    function judge(node, specifier) {
      if (typeof specifier !== "string") return context.report({ node, messageId: "unread" });
      const file = resolve(specifier);
      if (file === null) return;
      if (file === undefined) return context.report({ node, messageId: "unresolved", data: { specifier } });
      if (!file.startsWith("src/") || !SCRIPT.test(file) || edges.includes(file) || isServerModule(file)) return;
      context.report({ node, messageId: "own", data: { specifier, module: file } });
    }

    /** A literal's text, a template's with no expression, or `undefined` for anything else. */
    const text = (node) => {
      if (node?.type === "Literal" && typeof node.value === "string") return node.value;
      if (node?.type === "TemplateLiteral" && node.expressions.length === 0) return node.quasis[0].value.cooked;
      return undefined;
    };

    /** Judges each key of one of the helper's maps, `toSpecifier` turning a key into the specifier it replaces. */
    function judgeMap(map, toSpecifier) {
      if (map.type !== "ObjectExpression") return context.report({ node: map, messageId: "unread" });
      for (const entry of map.properties) {
        if (entry.type !== "Property" || entry.computed) {
          context.report({ node: entry, messageId: "unread" });
          continue;
        }
        const key = entry.key.type === "Identifier" ? entry.key.name : text(entry.key);
        judge(entry.key, key === undefined ? undefined : toSpecifier(key));
      }
    }

    return {
      ImportDeclaration(declaration) {
        for (const specifier of declaration.specifiers) {
          if (specifier.type !== "ImportSpecifier") continue;
          if (declaration.source.value === "vitest" && specifier.imported.name === "vi") vi = specifier.local.name;
          else if (specifier.imported.name === "registerAuthDoubles" && resolve(declaration.source.value) === HELPER_MODULE) {
            helper = specifier.local.name;
          }
        }
      },

      CallExpression(call) {
        const { callee } = call;
        const mocks =
          callee.type === "MemberExpression" &&
          !callee.computed &&
          callee.object.type === "Identifier" &&
          callee.object.name === vi &&
          (callee.property.name === "mock" || callee.property.name === "doMock");
        if (mocks) {
          const [target] = call.arguments;
          // Vitest takes the module as a specifier or as a dynamic import of it, which types the factory.
          return judge(target ?? call, text(target?.type === "ImportExpression" ? target.source : target));
        }

        if (callee.type !== "Identifier" || callee.name !== helper || helper === null) return;
        const [doubles] = call.arguments;
        if (doubles === undefined) return;
        if (doubles.type !== "ObjectExpression") return context.report({ node: doubles, messageId: "unread" });
        for (const entry of doubles.properties) {
          if (entry.type !== "Property" || entry.computed) {
            context.report({ node: entry, messageId: "unread" });
            continue;
          }
          const name = entry.key.type === "Identifier" ? entry.key.name : text(entry.key);
          if (name === "core") judgeMap(entry.value, (key) => `@/core/${key}.ts`);
          else if (name === "specifiers") judgeMap(entry.value, (key) => key);
        }
      },
    };
  },
};

export default noOwnModuleDouble;
