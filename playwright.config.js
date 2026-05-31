import { defineConfig } from "@playwright/test";

// E2E harness for the static app. Serves the repo over http (so ES modules and
// same-origin data/*.json load like production); the Worker + GitHub Contents
// API are mocked per-test via page.route (see e2e/*.spec.js).
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  reporter: [["list"]],
  use: { baseURL: "http://localhost:8788", browserName: "chromium" },
  webServer: {
    command: "python3 -m http.server 8788",
    url: "http://localhost:8788/index.html",
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
