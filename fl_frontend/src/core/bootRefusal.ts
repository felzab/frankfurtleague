/**
 * A boot gate refusing what the container was handed, thrown once its `CRITICAL` line is written. Any
 * other failure is a fault, and the boot ends on another code
 * (`fl_frontend/src/instrumentation-node.ts :: registerOnNode`).
 */
export class BootRefusal extends Error {}
