import { afterEach, describe, expect, it, vi } from "vitest";
import { checkRelayerReady } from "./stellar";
import { RELAYER_HEALTH_TIMEOUT_MS } from "./relayerBackoff";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("checkRelayerReady (#569)", () => {
  it("is ready only when the body status is ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ status: "ok" })));
    await expect(checkRelayerReady("http://relayer")).resolves.toMatchObject({ ok: true });
  });

  it("treats a 200 'degraded' body as not ready", async () => {
    // /health intentionally stays 200 while degraded (#204); the body decides.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ status: "degraded", services: {} })),
    );
    await expect(checkRelayerReady("http://relayer")).resolves.toMatchObject({ ok: false });
  });

  it("reports the HTTP status for a non-JSON error page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("<html>502 Bad Gateway</html>", { status: 502 })),
    );
    await expect(checkRelayerReady("http://relayer")).resolves.toEqual({
      ok: false,
      error: "relayer health check returned HTTP 502",
    });
  });

  it("passes a timeout signal so a hung relayer can't pile up requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: "ok" }));
    vi.stubGlobal("fetch", fetchMock);
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");

    await checkRelayerReady("http://relayer");

    expect(timeoutSpy).toHaveBeenCalledWith(RELAYER_HEALTH_TIMEOUT_MS);
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    timeoutSpy.mockRestore();
  });

  it("returns not-ready (not a throw) when the request times out or fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new DOMException("The operation timed out.", "TimeoutError")),
    );
    await expect(checkRelayerReady("http://relayer")).resolves.toEqual({
      ok: false,
      error: "The operation timed out.",
    });

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(checkRelayerReady("http://relayer")).resolves.toMatchObject({
      ok: false,
      error: "Failed to fetch",
    });
  });

  it("sends the bearer token when provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: "ok" }));
    vi.stubGlobal("fetch", fetchMock);
    await checkRelayerReady("http://relayer", "tok");
    expect(fetchMock.mock.calls[0][0]).toBe("http://relayer/health");
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ Authorization: "Bearer tok" });
  });
});
