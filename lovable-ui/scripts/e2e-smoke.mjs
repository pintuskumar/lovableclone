/* eslint-disable no-console */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const BASE_URL = process.env.E2E_BASE_URL || "http://127.0.0.1:3000";
const DEFAULT_TIMEOUT_MS = Number.parseInt(
  process.env.E2E_REQUEST_TIMEOUT_MS || "15000",
  10,
);
const E2E_AUTOSTART = process.env.E2E_AUTOSTART !== "0";
const SERVER_READY_TIMEOUT_MS = Number.parseInt(
  process.env.E2E_SERVER_READY_TIMEOUT_MS || "90000",
  10,
);
const SERVER_PROBE_INTERVAL_MS = Number.parseInt(
  process.env.E2E_SERVER_PROBE_INTERVAL_MS || "1000",
  10,
);

/** @type {import("node:child_process").ChildProcessWithoutNullStreams | null} */
let managedServer = null;

function withTimeout(ms = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timer),
  };
}

async function request(path, init = {}) {
  const { signal, cleanup } = withTimeout();
  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      redirect: "manual",
      ...init,
      signal,
    });
    const text = await response.text().catch(() => "");
    return { response, text };
  } finally {
    cleanup();
  }
}

function assertStatus(actual, expected, name, detail = "") {
  if (actual !== expected) {
    throw new Error(
      `${name}: expected ${expected}, got ${actual}${detail ? ` (${detail})` : ""}`,
    );
  }
}

function assertOneOfStatus(actual, expected, name, detail = "") {
  if (!expected.includes(actual)) {
    throw new Error(
      `${name}: expected one of [${expected.join(", ")}], got ${actual}${
        detail ? ` (${detail})` : ""
      }`,
    );
  }
}

function parseBaseUrl() {
  try {
    return new URL(BASE_URL);
  } catch {
    throw new Error(`Invalid E2E_BASE_URL: ${BASE_URL}`);
  }
}

async function probeServer(pathname = "/") {
  const { signal, cleanup } = withTimeout(1500);
  try {
    const response = await fetch(`${BASE_URL}${pathname}`, {
      redirect: "manual",
      signal,
    });
    return response.status > 0;
  } catch {
    return false;
  } finally {
    cleanup();
  }
}

async function waitForServerReady(timeoutMs = SERVER_READY_TIMEOUT_MS) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const ready = await probeServer("/");
    if (ready) {
      return;
    }
    await delay(SERVER_PROBE_INTERVAL_MS);
  }

  throw new Error(
    `Timed out waiting for server at ${BASE_URL} after ${timeoutMs}ms`,
  );
}

async function maybeStartManagedServer() {
  if (!E2E_AUTOSTART) return;
  if (await probeServer("/")) return;

  const base = parseBaseUrl();
  const host = base.hostname || "127.0.0.1";
  const port = base.port || "3000";
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error(
      `E2E_AUTOSTART only supports localhost/127.0.0.1, got host "${host}"`,
    );
  }

  const nextCli = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
  if (!fs.existsSync(nextCli)) {
    throw new Error(
      `Could not find Next.js CLI at ${nextCli}. Run npm install first.`,
    );
  }

  managedServer = spawn(process.execPath, [nextCli, "start", "--hostname", host, "--port", port], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });

  managedServer.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    process.stdout.write(`[server] ${text}`);
  });
  managedServer.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    process.stderr.write(`[server] ${text}`);
  });

  managedServer.on("exit", (code, signal) => {
    if (code !== 0 && signal !== "SIGTERM") {
      console.error(`[server] exited with code ${code ?? "null"} signal ${signal ?? "none"}`);
    }
  });

  await waitForServerReady();
}

async function stopManagedServer() {
  if (!managedServer) return;

  const server = managedServer;
  managedServer = null;

  if (server.exitCode !== null) {
    return;
  }

  server.kill("SIGTERM");

  const startedAt = Date.now();
  while (server.exitCode === null && Date.now() - startedAt < 5000) {
    await delay(100);
  }

  if (server.exitCode === null) {
    server.kill("SIGKILL");
  }
}

async function run() {
  await maybeStartManagedServer();

  try {
    const cases = [];

  const pagePaths = [
    "/",
    "/generate?prompt=smoke-test",
    "/community",
    "/connect4",
    "/hello-world",
    "/learn",
    "/login",
    "/privacy",
    "/projects",
    "/register",
    "/settings",
    "/terms",
  ];

  for (const path of pagePaths) {
    cases.push({
      name: `GET ${path}`,
      run: async () => {
        const { response } = await request(path);
        assertStatus(response.status, 200, `GET ${path}`);
        const contentType = response.headers.get("content-type") || "";
        if (!contentType.includes("text/html")) {
          throw new Error(`GET ${path}: expected HTML response`);
        }
      },
    });
  }

  cases.push(
    {
      name: "POST /api/generate wrong content-type",
      run: async () => {
        const { response } = await request("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: "hello",
        });
        assertStatus(response.status, 415, "POST /api/generate wrong content-type");
      },
    },
    {
      name: "POST /api/generate empty prompt validation",
      run: async () => {
        const { response } = await request("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: "" }),
        });
        assertStatus(response.status, 400, "POST /api/generate empty prompt");
      },
    },
    {
      name: "POST /api/generate invalid json validation",
      run: async () => {
        const { response } = await request("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{bad json",
        });
        assertStatus(response.status, 400, "POST /api/generate invalid json");
      },
    },
    {
      name: "POST /api/generate-daytona wrong content-type",
      run: async () => {
        const { response } = await request("/api/generate-daytona", {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: "hello",
        });
        assertStatus(
          response.status,
          415,
          "POST /api/generate-daytona wrong content-type",
        );
      },
    },
    {
      name: "POST /api/generate-daytona empty prompt validation",
      run: async () => {
        const { response } = await request("/api/generate-daytona", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: "" }),
        });
        assertStatus(response.status, 400, "POST /api/generate-daytona empty prompt");
      },
    },
    {
      name: "POST /api/generate origin enforcement",
      run: async () => {
        const { response } = await request("/api/generate", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "https://evil.example",
          },
          body: JSON.stringify({ prompt: "hello" }),
        });
        assertStatus(response.status, 403, "POST /api/generate origin enforcement");
      },
    },
    {
      name: "GET /api/auth/me unauthenticated",
      run: async () => {
        const { response } = await request("/api/auth/me");
        assertStatus(response.status, 401, "GET /api/auth/me");
      },
    },
    {
      name: "POST /api/auth/login wrong content-type",
      run: async () => {
        const { response } = await request("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: "x",
        });
        assertStatus(response.status, 415, "POST /api/auth/login wrong content-type");
      },
    },
    {
      name: "POST /api/auth/login missing credentials validation",
      run: async () => {
        const { response } = await request("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: "", password: "" }),
        });
        assertStatus(response.status, 400, "POST /api/auth/login missing creds");
      },
    },
    {
      name: "POST /api/auth/register wrong content-type",
      run: async () => {
        const { response } = await request("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: "x",
        });
        assertStatus(
          response.status,
          415,
          "POST /api/auth/register wrong content-type",
        );
      },
    },
    {
      name: "POST /api/auth/register invalid payload validation",
      run: async () => {
        const { response } = await request("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: "bad", password: "123" }),
        });
        assertStatus(response.status, 400, "POST /api/auth/register invalid payload");
      },
    },
    {
      name: "POST /api/auth/logout",
      run: async () => {
        const { response } = await request("/api/auth/logout", {
          method: "POST",
        });
        assertStatus(response.status, 200, "POST /api/auth/logout");
      },
    },
    {
      name: "PUT /api/sandbox/:id/files traversal blocked",
      run: async () => {
        const { response } = await request("/api/sandbox/fake-sandbox/files", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: "../escape.txt", content: "x" }),
        });
        assertStatus(response.status, 400, "PUT sandbox files traversal");
      },
    },
    {
      name: "DELETE /api/sandbox/:id/files traversal blocked",
      run: async () => {
        const { response } = await request(
          "/api/sandbox/fake-sandbox/files?path=../escape.txt",
          {
            method: "DELETE",
          },
        );
        assertStatus(response.status, 400, "DELETE sandbox files traversal");
      },
    },
    {
      name: "GET /api/sandbox/:id/files list mode handles missing sandbox",
      run: async () => {
        const { response } = await request(
          "/api/sandbox/fake-sandbox/files?list=1&depth=0",
        );
        // Can be 404 (expected) or 500 if remote Daytona credentials/network are unavailable.
        assertOneOfStatus(
          response.status,
          [404, 500],
          "GET sandbox files list mode missing sandbox",
        );
      },
    },
  );

  const results = [];
  let passed = 0;

  for (const testCase of cases) {
    const startedAt = Date.now();
    try {
      await testCase.run();
      const durationMs = Date.now() - startedAt;
      results.push({ name: testCase.name, ok: true, durationMs });
      passed += 1;
      console.log(`PASS ${testCase.name} (${durationMs}ms)`);
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      results.push({
        name: testCase.name,
        ok: false,
        durationMs,
        error: error instanceof Error ? error.message : String(error),
      });
      console.error(`FAIL ${testCase.name} (${durationMs}ms)`);
      console.error(`     ${results.at(-1).error}`);
    }
  }

  const failed = results.length - passed;
  console.log("");
  console.log(
    `Smoke E2E summary: ${passed}/${results.length} passed, ${failed} failed`,
  );

    if (failed > 0) {
      throw new Error(`Smoke E2E failures: ${failed}`);
    }
  } finally {
    await stopManagedServer();
  }
}

run().catch((error) => {
  console.error("Smoke E2E runner crashed:", error);
  process.exit(1);
});
