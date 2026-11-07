"use client";

import * as React from "react";
import Link from "next/link";
import { ShieldAlert, ArrowLeft, LogOut, Home } from "lucide-react";

export default function Forbidden403Page() {
  return (
    <div className="min-h-screen bg-[#D9DBEC] dark:bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-[32px] p-8 shadow-shell text-center space-y-6 border border-border-light dark:border-slate-800">
        <div className="w-20 h-20 mx-auto rounded-3xl bg-status-danger-bg text-status-danger-text flex items-center justify-center">
          <ShieldAlert className="w-10 h-10" />
        </div>

        <div className="space-y-2">
          <span className="text-xs font-bold uppercase tracking-wider text-status-danger-text px-3 py-1 rounded-full bg-status-danger-bg inline-block">
            HTTP 403 Forbidden
          </span>
          <h1 className="text-2xl font-extrabold text-text-primary dark:text-white">
            Access Denied
          </h1>
          <p className="text-sm text-text-secondary dark:text-slate-400">
            You do not have sufficient permissions or authoritative membership role to access this resource.
            Multi-factor authentication (AAL2) or organization administrator elevation may be required.
          </p>
        </div>

        <div className="pt-2 flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/"
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-2xl bg-brand-purple hover:bg-brand-purple-hover text-white text-sm font-semibold shadow-sm transition-all"
          >
            <Home className="w-4 h-4" />
            Dashboard
          </Link>
          <Link
            href="/login"
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-2xl bg-card-subtle hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-text-primary dark:text-slate-200 text-sm font-semibold transition-all"
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </Link>
        </div>
      </div>
    </div>
  );
}
