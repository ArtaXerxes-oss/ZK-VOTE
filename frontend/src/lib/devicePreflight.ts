/**
 * Below this much RAM (GB, as reported by navigator.deviceMemory) proving
 * tends to run out of memory, so the proving key is not worth downloading.
 */
export const MIN_DEVICE_MEMORY_GB = 2;

/**
 * Returns a plain-language reason this device cannot prove a vote, or null.
 * Browsers that do not report deviceMemory are allowed through.
 */
export function provingPreflightError(nav: Navigator = navigator): string | null {
  const memory = (nav as Navigator & { deviceMemory?: number }).deviceMemory;
  if (typeof memory === "number" && memory < MIN_DEVICE_MEMORY_GB) {
    return `This device reports ${memory} GB of memory, but generating a vote proof needs at least ${MIN_DEVICE_MEMORY_GB} GB. Try voting from a device with more memory.`;
  }
  return null;
}
