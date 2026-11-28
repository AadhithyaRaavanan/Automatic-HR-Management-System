import { defineConfig, devices } from "@playwright/test";
import * as dotenv from "dotenv";
import * as path from "path";
import { getAllowedTestBaseUrl } from "./tests/helpers/auth";

dotenv.config({ path: path.resolve(process.cwd(), ".env.test") });

const baseURL = getAllowedTestBaseUrl();

export default defineConfig({
  globalSetup: "./tests/helpers/global-setup.ts",
  testDir: "./tests",
  fullyParallel: false,
  timeout: 60 * 1000,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "off",
    screenshot: "only-on-failure",
    headless: true,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
