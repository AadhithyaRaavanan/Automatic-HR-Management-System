"use client";

import * as React from "react";
import Link from "next/link";
import { ShieldAlert, Sparkles } from "lucide-react";
import { useAppSession, type AppUserRole } from "@/components/shell/app-shell";

interface FeatureOrRoleGateProps {
  featureEnabled?: boolean;
  featureName?: string;
  allowedRoles?: AppUserRole[];
  children: React.ReactNode;
}

export function FeatureOrRoleGate({
  featureEnabled = true,
  featureName = "This module",
  allowedRoles,
  children,
}: FeatureOrRoleGateProps) {
  const { isLoaded, userRole } = useAppSession();

  if (!featureEnabled) {
    return (
      <div className="max-w-lg mx-auto my-12 p-6 rounded-2xl bg-white border border-[#E6E6E6] text-center space-y-3">
        <div className="w-10 h-10 rounded-xl bg-[#F5F5F5] text-black flex items-center justify-center mx-auto">
          <Sparkles className="w-5 h-5" />
        </div>
        <h2 className="text-base font-bold text-black">Feature not enabled</h2>
        <p className="text-xs text-[#666666] leading-relaxed">
          {featureName} is currently disabled for this deployment. Contact your organization administrator if your workspace requires access.
        </p>
        <Link
          href="/"
          className="inline-flex items-center justify-center px-4 py-2 rounded-xl bg-black text-white text-xs font-bold hover:bg-[#222222]"
        >
          Back to Dashboard
        </Link>
      </div>
    );
  }

  if (isLoaded && allowedRoles && !allowedRoles.includes(userRole)) {
    return (
      <div className="max-w-lg mx-auto my-12 p-6 rounded-2xl bg-white border border-[#E6E6E6] text-center space-y-3">
        <div className="w-10 h-10 rounded-xl bg-red-50 text-red-600 flex items-center justify-center mx-auto">
          <ShieldAlert className="w-5 h-5" />
        </div>
        <h2 className="text-base font-bold text-black">Role-restricted destination</h2>
        <p className="text-xs text-[#666666] leading-relaxed">
          {featureName} requires one of the following roles: {allowedRoles.join(", ").toUpperCase()}. Your current workspace role is {userRole}.
        </p>
        <Link
          href="/"
          className="inline-flex items-center justify-center px-4 py-2 rounded-xl bg-black text-white text-xs font-bold hover:bg-[#222222]"
        >
          Back to Dashboard
        </Link>
      </div>
    );
  }

  return <>{children}</>;
}
