import { RuleTester } from "eslint";
import nextTs from "eslint-config-next/typescript";
import { describe, it } from "vitest";

import noOwnModuleDouble from "./no-own-module-double.mjs";

RuleTester.describe = describe;
RuleTester.it = it;

// typescript-eslint's parser, as the project's own config registers it, which also reads each target's directive.
const { parser } = nextTs.find((entry) => entry.languageOptions?.parser !== undefined).languageOptions;

const tester = new RuleTester({ languageOptions: { parser, ecmaVersion: "latest", sourceType: "module" } });

// The specifiers resolve against the tree itself, as the rule reads it under `pnpm run lint`.
const options = [{ edges: ["src/core/config.ts", "src/core/db.ts"] }];
const TEST_FILE = "src/core/api.test.ts";

const VI = 'import { vi } from "vitest";\n';
const HELPER = 'import { registerAuthDoubles } from "@/test-support/authDoubles.ts";\n';

const valid = (code, filename = TEST_FILE) => ({ code: VI + code, filename, options });
const invalid = (code, messageId, filename = TEST_FILE) => ({ code: VI + code, filename, options, errors: [{ messageId }] });

tester.run("fl/no-own-module-double", noOwnModuleDouble, {
  valid: [
    // A library's module, an edge module and a server function as a client calls it.
    valid('vi.mock("next/navigation", () => ({}));'),
    valid('vi.doMock("@/core/config.ts", () => ({}));'),
    valid('vi.mock("./db", () => ({}));'),
    valid('vi.mock("@/features/grants/actions", () => ({}));'),
    // A file that is no script, whose import Next's loader makes.
    valid('vi.mock("./share-image.png", () => ({ default: {} }));', "src/app/rootMetadata.test.ts"),
    // The helper's maps: an edge by its `core` key, a library by its specifier.
    valid(HELPER + 'registerAuthDoubles({ core: { config: {}, db: {} }, specifiers: { "next/headers": {} } });'),
  ],
  invalid: [
    // A module of ours, by every spelling a specifier takes.
    invalid('vi.mock("@/core/api", () => ({}));', "own"),
    invalid('vi.doMock("@/core/api.ts", () => ({}));', "own"),
    invalid('vi.mock("./api", () => ({}));', "own"),
    invalid('vi.mock("../core/transport.ts", () => ({}));', "own", "src/app/page.test.tsx"),
    invalid('vi.mock(import("./api"), () => ({}));', "own"),
    // The helper's two doors to a module of ours.
    invalid(HELPER + "registerAuthDoubles({ core: { authIndexes: {} } });", "own"),
    invalid(HELPER + 'registerAuthDoubles({ specifiers: { "@/core/api.ts": {} } });', "own"),
    // What the rule cannot read.
    invalid("vi.mock(specifier, () => ({}));", "unread"),
    invalid("vi.mock(`./${name}`, () => ({}));", "unread"),
    invalid(HELPER + "registerAuthDoubles(doubles);", "unread"),
    invalid(HELPER + "registerAuthDoubles({ core: doubles });", "unread"),
    invalid(HELPER + "registerAuthDoubles({ core: { [name]: {} } });", "unread"),
    invalid(HELPER + "registerAuthDoubles({ ...doubles });", "unread"),
    invalid('vi.mock("@/core/nothing", () => ({}));', "unresolved"),
  ],
});
