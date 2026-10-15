/**
 * SDK version and compatibility information
 */

export const VERSION = '1.0.0'

/**
 * Circuit compatibility matrix
 * SDK version N supports circuits version N and N-1
 */
export const CIRCUIT_COMPATIBILITY = {
  '1.0.0': ['1.0', '0.9'],
  '0.9.0': ['0.9', '0.8']
}

/**
 * Check if circuit version is compatible with current SDK
 */
export function isCircuitCompatible(circuitVersion: string): boolean {
  const compatible = CIRCUIT_COMPATIBILITY[VERSION as keyof typeof CIRCUIT_COMPATIBILITY]
  return compatible ? compatible.includes(circuitVersion) : false
}

/**
 * Get SDK version
 */
export function getVersion(): string {
  return VERSION
}

/**
 * Get supported circuit versions
 */
export function getSupportedCircuitVersions(): string[] {
  return CIRCUIT_COMPATIBILITY[VERSION as keyof typeof CIRCUIT_COMPATIBILITY] || []
}
