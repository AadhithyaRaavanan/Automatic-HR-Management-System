import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import fs from "node:fs";
import path from "node:path";
import packageJson from "../../package.json";
import { isDemoModeEnabled } from "@/lib/config/demo";

const dbConfig = {
  host: process.env.SUPABASE_DB_HOST || "127.0.0.1",
  port: Number(process.env.SUPABASE_DB_PORT) || 54322,
  user: process.env.SUPABASE_DB_USER || "postgres",
  password: process.env.SUPABASE_DB_PASSWORD || "postgres",
  database: process.env.SUPABASE_DB_NAME || "postgres",
};

// Helper: Calculate WCAG relative luminance
function getRelativeLuminance(hex: string): number {
  const cleanHex = hex.replace("#", "");
  const r = parseInt(cleanHex.substring(0, 2), 16) / 255;
  const g = parseInt(cleanHex.substring(2, 4), 16) / 255;
  const b = parseInt(cleanHex.substring(4, 6), 16) / 255;

  const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

// Helper: Calculate WCAG contrast ratio between two colors
function getContrastRatio(hex1: string, hex2: string): number {
  const lum1 = getRelativeLuminance(hex1);
  const lum2 = getRelativeLuminance(hex2);
  const lighter = Math.max(lum1, lum2);
  const darker = Math.min(lum1, lum2);
  return (lighter + 0.05) / (darker + 0.05);
}

describe("Section 11: Design System & Frontend UX", () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client(dbConfig);
    await client.connect();
  });

  afterAll(async () => {
    await client.end();
  });

  // [F11.1.1] Bento Grid Architecture & Design Tokens
  it("[F11.1.1] verifies Bento grid design tokens (#D9DBEC, #6C5CE7, #14123A, 32px)", () => {
    // 1. Inspect globals.css for design tokens
    const cssPath = path.resolve(process.cwd(), "src/app/globals.css");
    const cssContent = fs.readFileSync(cssPath, "utf-8");

    expect(cssContent).toMatch(/--canvas-bg:\s*#D9DBEC/i);
    expect(cssContent).toMatch(/--brand-purple:\s*#6C5CE7/i);
    expect(cssContent).toMatch(/--brand-navy:\s*#14123A/i);

    // 2. Inspect sidebar for curved shell layout
    const sidebarPath = path.resolve(process.cwd(), "src/components/shell/curved-sidebar.tsx");
    const sidebarContent = fs.readFileSync(sidebarPath, "utf-8");
    expect(sidebarContent).toMatch(/rounded-r-\[28px\]|rounded-r-\[32px\]/);
    expect(sidebarContent).toMatch(/bg-brand-purple/);
  });

  // [F11.1.2] Typography & WCAG AA Contrast Compliance
  it("[F11.1.2] verifies Plus Jakarta Sans typography and WCAG AA contrast (>= 4.5:1)", () => {
    // 1. Plus Jakarta Sans in Tailwind config
    const twPath = path.resolve(process.cwd(), "tailwind.config.ts");
    const twContent = fs.readFileSync(twPath, "utf-8");
    expect(twContent).toMatch(/font-plus-jakarta-sans/i);

    // 2. WCAG AA Contrast ratios:
    // Deep Navy (#14123A) on White (#FFFFFF)
    const navyOnWhite = getContrastRatio("#14123A", "#FFFFFF");
    expect(navyOnWhite).toBeGreaterThanOrEqual(4.5);
    expect(navyOnWhite).toBeGreaterThan(15.0); // Actual ~17.2:1

    // Deep Navy (#14123A) on Soft Lavender Canvas (#D9DBEC)
    const navyOnLavender = getContrastRatio("#14123A", "#D9DBEC");
    expect(navyOnLavender).toBeGreaterThanOrEqual(4.5);
    expect(navyOnLavender).toBeGreaterThan(10.0); // Actual ~12.3:1

    // White (#FFFFFF) on Brand Purple (#6C5CE7)
    const whiteOnPurple = getContrastRatio("#FFFFFF", "#6C5CE7");
    expect(whiteOnPurple).toBeGreaterThanOrEqual(4.5); // Actual ~4.63:1
  });

  // [F11.2.1] Realtime Notifications & Private Topic Isolation
  it("[F11.2.1] verifies Realtime private topic naming and policy isolation in database", async () => {
    // Check RLS policy on realtime.messages
    const policyRes = await client.query(`
      SELECT policyname, qual 
      FROM pg_policies 
      WHERE schemaname = 'realtime' AND tablename = 'messages'
        AND policyname = 'realtime_notifications_user_select_policy';
    `);

    expect(policyRes.rows.length).toBe(1);
    const policyQual = policyRes.rows[0].qual;
    // Qual enforces realtime.topic() = 'notifications:user:' || auth.uid()
    expect(policyQual).toMatch(/notifications:user:/i);
  });

  // [F11.2.2] Sonner Toast System & Production Component Guards
  it("[F11.2.2] verifies Sonner toast integration and production guard on /gallery route", () => {
    // 1. Sonner dependency in package.json
    expect((packageJson.dependencies as any)["sonner"]).toBeDefined();

    // 2. /gallery route checks isDemoModeEnabled()
    const galleryPagePath = path.resolve(process.cwd(), "src/app/gallery/page.tsx");
    const galleryContent = fs.readFileSync(galleryPagePath, "utf-8");
    expect(galleryContent).toMatch(/isDemoModeEnabled\(\)/);
    expect(galleryContent).toMatch(/notFound\(\)/);

    // 3. In non-demo environment, isDemoModeEnabled returns false
    const originalEnv = process.env.NEXT_PUBLIC_DEMO_MODE;
    try {
      delete process.env.NEXT_PUBLIC_DEMO_MODE;
      expect(isDemoModeEnabled()).toBe(false);
    } finally {
      if (originalEnv !== undefined) {
        process.env.NEXT_PUBLIC_DEMO_MODE = originalEnv;
      }
    }
  });
});
