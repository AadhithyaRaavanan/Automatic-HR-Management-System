"use client";

import * as React from "react";

export function PwaRegister() {
  React.useEffect(() => {
    if (typeof window !== "undefined" && "serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        navigator.serviceWorker
          .register("/sw.js")
          .then((reg) => {
            // Check for updates
            reg.onupdatefound = () => {
              const installingWorker = reg.installing;
              if (installingWorker) {
                installingWorker.onstatechange = () => {
                  if (installingWorker.state === "installed") {
                    if (navigator.serviceWorker.controller) {
                      // New content available; can auto-update
                    }
                  }
                };
              }
            };
          })
          .catch((err) => {
            console.warn("[PWA] Service worker registration failed:", err);
          });
      });
    }
  }, []);

  return null;
}
