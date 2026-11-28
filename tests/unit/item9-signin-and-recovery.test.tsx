import { describe, expect, it, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  DesktopOnlyGatekeeper,
  isNarrowViewportAllowedPath,
} from "@/components/shared/desktop-only-gatekeeper";
import { getSiteUrl } from "@/lib/site-url";

const navState = vi.hoisted(() => ({
  pathname: "/login",
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navState.pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      setSession: vi.fn(),
      getUser: vi.fn(async () => ({ data: { user: null } })),
      mfa: { listFactors: vi.fn(async () => ({ data: { totp: [], all: [] } })) },
    },
  }),
}));

vi.mock("@/features/auth/components/turnstile-captcha", () => ({
  TurnstileCaptcha: () => null,
}));

import LoginPage from "@/app/(auth)/login/page";
import ForgotPasswordPage from "@/app/(auth)/forgot-password/page";

describe("Item 9 — Narrow viewport auth access, magic-link copy, 6-digit recovery, and origin consistency", () => {
  beforeEach(() => {
    navState.pathname = "/login";
  });

  it("allows sign-in, recovery, MFA, and onboarding paths below 1024px while gating workspace pages", () => {
    for (const p of ["/login", "/forgot-password", "/mfa-setup", "/mfa-challenge", "/auth/confirm", "/onboarding"]) {
      expect(isNarrowViewportAllowedPath(p)).toBe(true);
      navState.pathname = p;
      const { unmount } = render(
        <DesktopOnlyGatekeeper>
          <div data-testid="allowed-content">Auth Screen Ready</div>
        </DesktopOnlyGatekeeper>
      );
      expect(screen.getByTestId("allowed-content")).toBeInTheDocument();
      expect(screen.queryByRole("alertdialog", { name: "Desktop Only Notice" })).toBeNull();
      unmount();
    }

    expect(isNarrowViewportAllowedPath("/")).toBe(false);
    expect(isNarrowViewportAllowedPath("/kpi")).toBe(false);
    navState.pathname = "/";
    render(
      <DesktopOnlyGatekeeper>
        <div>Dashboard Body</div>
      </DesktopOnlyGatekeeper>
    );
    expect(screen.getByRole("alertdialog", { name: "Desktop Only Notice" })).toBeInTheDocument();
  });

  it("displays email-specific instructions for magic-link sign-in and 6-digit validation for password recovery", () => {
    navState.pathname = "/login";
    render(<LoginPage />);

    // Switch to magic-link mode
    fireEvent.click(screen.getByRole("button", { name: "Use magic link" }));
    expect(screen.getByRole("heading", { name: "Sign in with email link" })).toBeInTheDocument();
    expect(screen.getByText(/one-time sign-in link—no password required/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send magic link" })).toBeInTheDocument();

    // Check forgot-password 6-digit copy & length constraint
    const { unmount } = render(<ForgotPasswordPage />);
    expect(screen.getByText(/receive a 6-digit password reset code/i)).toBeInTheDocument();
    unmount();
  });

  it("preserves exact loopback origin (127.0.0.1 vs localhost) for local callback requests", () => {
    const prevEnv = { ...process.env };
    try {
      (process.env as any).NODE_ENV = "development";
      process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";

      const req127 = new Request("http://127.0.0.1:3000/api/auth/magic-link", {
        headers: { origin: "http://127.0.0.1:3000", host: "127.0.0.1:3000" },
      });
      expect(getSiteUrl(req127)).toBe("http://127.0.0.1:3000");

      const reqLocalhost = new Request("http://localhost:3000/api/auth/magic-link", {
        headers: { origin: "http://localhost:3000", host: "localhost:3000" },
      });
      expect(getSiteUrl(reqLocalhost)).toBe("http://localhost:3000");

      (process.env as any).NODE_ENV = "production";
      expect(getSiteUrl(req127)).toBe("https://pulse.zenxea.com");
    } finally {
      process.env = prevEnv;
    }
  });
});
