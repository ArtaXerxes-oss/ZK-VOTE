import { describe, it, expect } from "vitest";
import { provingPreflightError } from "./devicePreflight";

const withMemory = (deviceMemory?: number) => ({ deviceMemory }) as unknown as Navigator;

describe("provingPreflightError", () => {
  it("blocks devices below the memory floor", () => {
    expect(provingPreflightError(withMemory(1))).toMatch(/at least 2 GB/);
  });

  it("allows devices at or above the floor", () => {
    expect(provingPreflightError(withMemory(2))).toBeNull();
    expect(provingPreflightError(withMemory(8))).toBeNull();
  });

  it("allows browsers that do not report memory", () => {
    expect(provingPreflightError(withMemory(undefined))).toBeNull();
  });
});
