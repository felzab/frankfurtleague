import { readFileSync } from "node:fs";

import { defineConfig } from "orval";

const DOCUMENT_PATH = "../fl_backend/openapi.json";
const TRANSPORT_PATH = "@/core/transport";

// Each key tier's scheme in the document's `components.securitySchemes`, and the transport export sending its key.
const TRANSPORT_BY_SCHEME: Readonly<Record<string, string>> = {
  BaseKey: "baseKeyTransport",
  SystemKey: "systemKeyTransport",
  AdminKey: "adminKeyTransport",
};

type Security = readonly Readonly<Record<string, readonly string[]>>[];
type Operation = { operationId: string; security?: Security };
type Document = { security?: Security; paths: Record<string, Record<string, Operation>> };

const document = JSON.parse(readFileSync(DOCUMENT_PATH, "utf8")) as Document;

/**
 * The transport an operation is sent through, read off its `security`, so the key a call sends is the one the
 * backend's guard names and no call site chooses it. A scheme this map does not know fails the generation.
 */
function transportOf({ operationId, security = document.security ?? [] }: Operation): string {
  const schemes = security.flatMap(Object.keys);
  if (schemes.length === 0) return "unkeyedTransport";

  const transport = schemes.length === 1 ? TRANSPORT_BY_SCHEME[schemes[0] ?? ""] : undefined;
  if (!transport) throw new Error(`${operationId}: no transport for the security ${JSON.stringify(security)}`);
  return transport;
}

const operations = Object.fromEntries(
  Object.values(document.paths)
    .flatMap((methods) => Object.values(methods))
    .map((operation) => [operation.operationId, { mutator: { path: TRANSPORT_PATH, name: transportOf(operation) } }]),
);

// A verbatim string, so the line lands as code ahead of the file's imports rather than as a comment.
const SERVER_ONLY = () => "import 'server-only';\n";

// Two projects, each with a folder of its own: `clean` wipes its target's folder before it writes, so two projects
// sharing one would each delete the other's output. Each formats what it writes with the repository's Prettier
// config, because Orval's own output ends `types.ts` in a blank line, which the docs scope's `git diff --check`
// refuses. The formatter reads that config directly and never `.prettierignore`, which keeps the format scope off
// this folder.
export default defineConfig({
  client: {
    input: { target: DOCUMENT_PATH },
    output: {
      mode: "single",
      client: "fetch",
      target: "src/core/generated/client/sdk.ts",
      schemas: { path: "src/core/generated/client/types.ts", mode: "single" },
      indexFiles: false,
      clean: true,
      formatter: "prettier",
      // Each path parameter percent-encoded where its URL is built (https://orval.dev/docs/reference/configuration/output),
      // so an id read off a page address or a stored record stays one segment and no call site encodes its own.
      urlEncodeParameters: true,
      override: {
        // Orval writes one header to the target and its schemas file, and `types.ts` holds only the document's
        // types and value lists, which a client module imports. The SDK is server-only through its transport.
        header: false,
        operations,
        paramsSerializer: { path: TRANSPORT_PATH, name: "serializeQuery" },
        // A call answers its success body; `apiClient` throws on any other status.
        fetch: { includeHttpResponseReturnType: false },
      },
    },
  },
  zod: {
    input: { target: DOCUMENT_PATH },
    output: {
      mode: "single",
      client: "zod",
      target: "src/core/generated/zod/inputs.ts",
      indexFiles: false,
      clean: true,
      formatter: "prettier",
      override: {
        header: SERVER_ONLY,
        zod: {
          version: 4,
          // Untrusted input alone: a response is typed, never parsed.
          generate: { param: true, query: true, header: false, body: true, response: false },
        },
      },
    },
  },
});
