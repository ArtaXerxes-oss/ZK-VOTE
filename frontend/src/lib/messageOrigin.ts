/**
 * PostMessage origin security validation.
 * Protects against cross-origin postMessage attacks from malicious domains (e.g., evil.com).
 */

const TRUSTED_ORIGINS = [
  "https://api.soroswap.finance",
  "https://app.soroswap.finance",
  "https://soroswap.finance",
];

export function isAllowedMessageOrigin(origin: string): boolean {
  if (!origin) return false;

  // Same-origin is allowed
  if (typeof window !== "undefined" && origin === window.location.origin) {
    return true;
  }

  // Configured Soroswap API origin
  const soroswapApiUrl = (import.meta as any).env?.VITE_SOROSWAP_API;
  if (soroswapApiUrl) {
    try {
      const soroswapOrigin = new URL(soroswapApiUrl).origin;
      if (origin === soroswapOrigin) return true;
    } catch {
      // Ignore invalid URL
    }
  }

  // Trusted default origins
  if (TRUSTED_ORIGINS.includes(origin)) {
    return true;
  }

  return false;
}
