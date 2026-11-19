"use client";

import * as React from "react";

export function ThemeProvider({
  children,
}: {
  children: React.ReactNode;
  [key: string]: any;
}) {
  React.useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.classList.remove("dark");
      document.documentElement.classList.add("light");
      try {
        localStorage.removeItem("theme");
        localStorage.removeItem("next-theme");
      } catch {}
    }
  }, []);

  return <>{children}</>;
}
