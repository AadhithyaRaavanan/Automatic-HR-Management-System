import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { QueryProvider } from "@/components/query-provider";
import { AttendanceProvider } from "@/features/attendance/context/attendance-context";
import { Toaster } from "sonner";
import { DesktopOnlyGatekeeper } from "@/components/shared/desktop-only-gatekeeper";
import { PwaRegister } from "@/components/pwa/pwa-register";
import "./globals.css";

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-plus-jakarta-sans",
  display: "swap",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#000000",
};

export const metadata: Metadata = {
  title: "Pulse",
  description: "Internal attendance and workforce management for Zenxea.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Pulse",
  },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192x192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512x512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={plusJakartaSans.variable}>
      <head>
        <meta name="application-name" content="Pulse" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Pulse" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="theme-color" content="#000000" />
      </head>
      <body className="font-sans antialiased bg-canvas min-h-screen text-text-primary selection:bg-lime selection:text-black">
        <PwaRegister />
        <ThemeProvider>
          <QueryProvider>
            <DesktopOnlyGatekeeper>
              <AttendanceProvider>
                {children}
              </AttendanceProvider>
            </DesktopOnlyGatekeeper>
            <Toaster
              position="top-right"
              toastOptions={{
                style: {
                  background: "#000000",
                  color: "#FFFFFF",
                  border: "1px solid #1A1A1A",
                  borderRadius: "10px",
                },
              }}
            />
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
