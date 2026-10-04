/**
 * A boot gate refusing what the container was handed, thrown once its `CRITICAL` line is written. Every
 * other failure of the boot is a fault rather than a verdict, and the two end the process on different
 * codes (`fl_frontend/src/instrumentation-node.ts :: registerOnNode`).
 */
export class BootRefusal extends Error {}
