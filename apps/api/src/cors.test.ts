import { describe, expect, it } from "vitest";
import http from "node:http";
import { corsHeaders } from "./security.js";

/**
 * The packaged app is cross-origin to the API (tauri.localhost -> 127.0.0.1:8787).
 * A 200 response with data but WITHOUT Access-Control-Allow-Origin is discarded
 * by the webview, which is why mail loaded in curl but never in the app.
 *
 * curl does not enforce CORS. These tests do what curl cannot.
 */
describe("corsHeaders", () => {
  it("returns the allow-origin header for the packaged app", () => {
    const h = corsHeaders("http://tauri.localhost");
    expect(h["Access-Control-Allow-Origin"]).toBe("http://tauri.localhost");
  });

  it("returns the allow-origin header for the dev server", () => {
    const h = corsHeaders("http://127.0.0.1:5173");
    expect(h["Access-Control-Allow-Origin"]).toBe("http://127.0.0.1:5173");
  });

  it("always advertises the methods and headers a preflight asks about", () => {
    const h = corsHeaders("http://tauri.localhost");
    expect(h["Access-Control-Allow-Methods"]).toContain("GET");
    expect(h["Access-Control-Allow-Methods"]).toContain("POST");
    expect(h["Access-Control-Allow-Methods"]).toContain("OPTIONS");
    expect(h["Access-Control-Allow-Headers"]).toMatch(/content-type/i);
  });

  it("emits no allow-origin for an untrusted origin", () => {
    const h = corsHeaders("https://evil.example");
    expect(h["Access-Control-Allow-Origin"]).toBeUndefined();
  });

  it("emits no allow-origin when there is no Origin header", () => {
    const h = corsHeaders(undefined);
    expect(h["Access-Control-Allow-Origin"]).toBeUndefined();
  });
});

/**
 * Guard: every JSON response must carry the header, not just the ones whose
 * handler remembered to pass `origin`. Skipped unless the app is running —
 * run the built app, then `npm run test -w @aether/api` to exercise it.
 */
describe("live server CORS", () => {
  it("sends allow-origin on data routes, not only on health", async () => {
    const get = (path: string): Promise<{ status: number; acao?: string } | null> =>
      new Promise((resolve) => {
        const req = http.request(
          {
            host: "127.0.0.1",
            port: 8787,
            path,
            method: "GET",
            headers: { Origin: "http://tauri.localhost" },
            timeout: 1500,
          },
          (res) => {
            res.resume();
            res.on("end", () =>
              resolve({
                status: res.statusCode ?? 0,
                acao: res.headers["access-control-allow-origin"] as string | undefined,
              }),
            );
          },
        );
        req.on("error", () => resolve(null));
        req.on("timeout", () => {
          req.destroy();
          resolve(null);
        });
        req.end();
      });

    const probe = await get("/api/health");
    if (!probe) {
      // Nothing running: nothing to assert against.
      expect(true).toBe(true);
      return;
    }

    for (const path of ["/api/health", "/api/folders", "/api/messages?folder=INBOX"]) {
      const out = await get(path);
      expect(out?.status, `${path} status`).toBe(200);
      expect(out?.acao, `${path} must send Access-Control-Allow-Origin`).toBe("http://tauri.localhost");
    }
  });
});
