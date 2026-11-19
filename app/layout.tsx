import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { QueryProvider } from "@/components/query-provider";
import { AttendanceProvider } from "@/features/attendance/context/attendance-context";
import { Toaster } from "sonner";
import { DesktopOnlyGatekeeper } from "@/components/shared/desktop-only-gatekeeper";
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
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={plusJakartaSans.variable}>
      <body className="font-sans antialiased bg-canvas min-h-screen text-text-primary selection:bg-lime selection:text-black">
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
