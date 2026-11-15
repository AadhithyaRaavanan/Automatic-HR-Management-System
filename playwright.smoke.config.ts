import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testMatch: "**/tests/e2e/production-smoke.spec.ts",
  timeout: 30 * 1000,
  workers: 1,
  use: {
    baseURL: "http://localhost:3005",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } },
    },
  ],
  webServer: {
    command: "node node_modules/next/dist/bin/next start -p 3005",
    url: "http://localhost:3005/api/health",
    reuseExistingServer: false,
    timeout: 60 * 1000,
    env: {
      NODE_ENV: "production",
      PORT: "3005",
      NEXT_PUBLIC_APP_URL: "http://localhost:3005",
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "dummy-anon",
      SUPABASE_SERVICE_ROLE_KEY: "dummy-service",
      NEXT_PUBLIC_DEMO_MODE: "false",
    },
  },
});
