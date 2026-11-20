import { readFileSync } from "node:fs";

import { defineConfig } from "orval";

// The one query parameter `adminKeyDryRunTransport` reads a dry run off.
import { DRY_RUN } from "./src/core/dryRun";

// The gate's contract check names a scratch folder of its own here, so it generates beside the tree, never into it.
const SCRATCH = process.env.CONTRACT_SCRATCH;
const DOCUMENT_PATH = SCRATCH ? `${SCRATCH}/openapi.json` : "../fl_backend/openapi.json";
const GENERATED = SCRATCH ? `${SCRATCH}/generated` : "src/core/generated";
const TRANSPORT_PATH = "@/core/transport";

/** The transport exports sending one key: a call that may write, one that writes nothing, a dry run's, and an hourly pass's. */
type Transports = { write: string; read?: string; dryRun?: string; pass?: string };

// A pass is the system key's alone: no other caller waits out its minute.
const TRANSPORTS_BY_SCHEME: Readonly<Record<string, Transports>> = {
  BaseKey: { write: "baseKeyTransport", read: "baseKeyReadTransport" },
  SystemKey: { write: "systemKeyTransport", read: "systemKeyReadTransport", pass: "systemKeyPassTransport" },
  AdminKey: { write: "adminKeyTransport", read: "adminKeyReadTransport", dryRun: "adminKeyDryRunTransport" },
};

// The backend's two unkeyed operations, which the container's healthcheck and nginx call and no frontend code does:
// left out, so the client holds no call without a key.
const PROBES = ["system_check_is_live", "system_check_is_ready"];

type Security = readonly Readonly<Record<string, readonly string[]>>[];
type Operation = { operationId: string; security?: Security; "x-safe"?: boolean; "x-safe-when"?: string; "x-pass"?: boolean };
type Document = { security?: Security; paths: Record<string, Record<string, Operation>> };

const document = JSON.parse(readFileSync(DOCUMENT_PATH, "utf8")) as Document;

/**
 * The transport an operation is sent through, read off the operation itself, so no call site chooses either: the key
 * its `security` names, and whether it writes, which the backend states where the method does not say it, as
 * `x-safe` on a POST that writes nothing and `x-safe-when` on a write whose dry run writes nothing (the backend's
 * `SAFE`), and whether it is an hourly pass, which `x-pass` states (the backend's `PASS`). An operation naming no key,
 * and a scheme or a mark no transport here serves, fails the generation. `x-safe-when` is compared with `DRY_RUN`
 * rather than trusted, so a backend renaming the parameter fails here instead of the transport sending its dry runs as
 * writes.
 */
function transportOf(operation: Operation): string {
  const { operationId, security = document.security ?? [] } = operation;
  const schemes = security.flatMap(Object.keys);
  const transports = schemes.length === 1 ? TRANSPORTS_BY_SCHEME[schemes[0] ?? ""] : undefined;
  if (!transports) throw new Error(`${operationId}: no transport for the security ${JSON.stringify(security)}`);

  const safeWhen = operation["x-safe-when"];
  const marks = [operation["x-safe"] === true, safeWhen !== undefined, operation["x-pass"] === true].filter(Boolean).length;
  const transport =
    marks > 1
      ? undefined
      : operation["x-pass"] === true
        ? transports.pass
        : operation["x-safe"] === true
          ? transports.read
          : safeWhen === undefined
            ? transports.write
            : safeWhen === DRY_RUN
              ? transports.dryRun
              : undefined;
  if (!transport) throw new Error(`${operationId}: no transport for its marks under the security ${JSON.stringify(security)}`);
  return transport;
}

const operations = Object.fromEntries(
  Object.values(document.paths)
    .flatMap((methods) => Object.values(methods))
    .filter(({ operationId }) => !PROBES.includes(operationId))
    .map((operation) => [operation.operationId, { mutator: { path: TRANSPORT_PATH, name: transportOf(operation) } }]),
);

// A verbatim string, so the line lands as code ahead of the file's imports rather than as a comment.
const SERVER_ONLY = () => "import 'server-only';\n";

// Each project formats what it writes with the repository's Prettier config, because Orval's own output ends
// `types.ts` in a blank line, which the docs scope's `git diff --check` refuses. The formatter reads that config
// directly and never `.prettierignore`, which keeps the format scope off this folder.
export default defineConfig({
  client: {
    input: {
      target: DOCUMENT_PATH,
      // Every schema kept: the backend publishes bounds no operation names, which the client's types mirror.
      filters: { mode: "exclude", operationIds: PROBES, includeUnreferencedSchemas: true },
    },
    output: {
      mode: "single",
      client: "fetch",
      target: `${GENERATED}/client/sdk.ts`,
      schemas: { path: `${GENERATED}/client/types.ts`, mode: "single" },
      indexFiles: false,
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
        // A call answers its success body; `sendToBackend` throws on any other status.
        fetch: { includeHttpResponseReturnType: false },
      },
    },
  },
  zod: {
    input: { target: DOCUMENT_PATH },
    output: {
      mode: "single",
      client: "zod",
      target: `${GENERATED}/zod/inputs.ts`,
      indexFiles: false,
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
