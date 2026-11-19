"use client";

import * as React from "react";
import Link from "next/link";
import { ShieldAlert, LogOut, Home } from "lucide-react";

export default function Forbidden403Page() {
  return (
    <div className="min-h-screen bg-[#F5F5F5] flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-[14px] p-8 text-center space-y-6 border border-[#E6E6E6] shadow-none">
        <div className="w-14 h-14 mx-auto rounded-full bg-[#F5F5F5] border border-[#E6E6E6] text-black flex items-center justify-center">
          <ShieldAlert className="w-6 h-6 text-black" />
        </div>

        <div className="space-y-2">
          <span className="text-[11px] font-semibold text-[#808080] px-2.5 py-1 rounded-full bg-[#F5F5F5] border border-[#E6E6E6] inline-block">
            HTTP 403 Forbidden
          </span>
          <h1 className="text-2xl font-bold text-black tracking-tight">
            Access denied
          </h1>
          <p className="text-sm text-[#808080]">
            You do not have sufficient permissions to access this resource.
            Organization administrator elevation may be required.
          </p>
        </div>

        <div className="pt-2 flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/"
            className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-black hover:bg-[#1A1A1A] text-white text-xs font-semibold transition-colors"
          >
            <Home className="w-3.5 h-3.5" />
            Dashboard
          </Link>
          <Link
            href="/login"
            className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-white hover:bg-[#F5F5F5] border border-[#E6E6E6] text-black text-xs font-semibold transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign out
          </Link>
        </div>
      </div>
    </div>
  );
}

