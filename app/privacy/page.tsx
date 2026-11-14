import Link from "next/link";
import appConfig from "@/lib/config";
import { Shield, ArrowLeft } from "lucide-react";

export const metadata = {
  title: `Privacy Policy — ${appConfig.companyName}`,
  description: "Our commitment to ethical, privacy-first workforce management.",
};

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto bg-white rounded-2xl p-8 sm:p-12 shadow-sm border border-slate-200">
        <div className="mb-6">
          <Link
            href="/login"
            className="inline-flex items-center gap-2 text-sm text-indigo-600 hover:text-indigo-800 transition"
          >
            <ArrowLeft className="w-4 h-4" /> Back to Login
          </Link>
        </div>

        <div className="flex items-center gap-3 mb-6">
          <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl">
            <Shield className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Privacy Policy</h1>
            <p className="text-sm text-slate-500">Effective Date: November 2026</p>
          </div>
        </div>

        <div className="space-y-6 text-sm leading-relaxed text-slate-600">
          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-2">1. Our Privacy Manifesto</h2>
            <p>
              At <strong>{appConfig.companyName}</strong>, we believe workforce productivity is built on mutual trust,
              clarity, and accountability—not continuous invasive monitoring. We strictly reject and do not implement
              background keystroke logging, silent screen capture, web browsing interception, or webcam surveillance.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-2">2. Data We Collect</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>Account profile details (Full name, business email, role title, department).</li>
              <li>Attendance punches explicitly triggered by you (Clock-in and clock-out timestamps).</li>
              <li>Leave requests, manager approvals, and optional notes entered by employees.</li>
              <li>System audit logs for high-privilege configuration and security operations.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-2">3. Multi-Tenant Isolation</h2>
            <p>
              Your enterprise data is strictly isolated using PostgreSQL Row-Level Security (RLS) policies scoped
              by tenant organization identifiers. No user from another organization can access or view your company records.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-2">4. Contact & Inquiries</h2>
            <p>
              If you have any questions regarding data protection or your rights under applicable privacy legislation,
              please reach out to our privacy officer at{" "}
              <a href={`mailto:${appConfig.supportEmail}`} className="text-indigo-600 underline font-medium">
                {appConfig.supportEmail}
              </a>.
            </p>
          </section>
        </div>

        <div className="mt-10 pt-6 border-t border-slate-200 text-xs text-slate-400 text-center">
          &copy; {new Date().getFullYear()} {appConfig.companyName}. All rights reserved.
        </div>
      </div>
    </div>
  );
}
