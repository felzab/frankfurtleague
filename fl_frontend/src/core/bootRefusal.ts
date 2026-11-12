/**
 * A boot gate refusing what the container was handed, thrown once its `CRITICAL` line is written. Any
 * other failure is a fault, and the boot ends on another exit code.
 */
export class BootRefusal extends Error {}
