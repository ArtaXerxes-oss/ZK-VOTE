import { describe, it, expect } from "vitest";
import { isAllowedMessageOrigin } from "./messageOrigin";

describe("isAllowedMessageOrigin", () => {
  it("blocks untrusted origins like evil.com", () => {
    expect(isAllowedMessageOrigin("https://evil.com")).toBe(false);
    expect(isAllowedMessageOrigin("http://attacker.org")).toBe(false);
    expect(isAllowedMessageOrigin("https://evil.soroswap.finance.attacker.com")).toBe(false);
  });

  it("blocks null or empty origins", () => {
    expect(isAllowedMessageOrigin("")).toBe(false);
    expect(isAllowedMessageOrigin(null as any)).toBe(false);
    expect(isAllowedMessageOrigin(undefined as any)).toBe(false);
  });

  it("allows trusted soroswap origins", () => {
    expect(isAllowedMessageOrigin("https://api.soroswap.finance")).toBe(true);
    expect(isAllowedMessageOrigin("https://app.soroswap.finance")).toBe(true);
    expect(isAllowedMessageOrigin("https://soroswap.finance")).toBe(true);
  });
});
