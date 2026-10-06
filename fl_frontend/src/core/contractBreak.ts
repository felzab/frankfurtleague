import "server-only";

import { isContractBreak } from "./errors";
import { logger } from "./logging";

/**
 * An admin editor's label readout's rejection handler, logging under the error boundary's own code.
 * The editor is the operator's tool for repairing the record, so it stands where a person-facing page
 * would not render.
 */
export function nullAfterLoggingContractBreak(error: unknown): null {
  if (isContractBreak(error)) logger.error("Contract break absorbed by an admin readout", error, { error_code: "FE-RSC-001" });

  return null;
}
