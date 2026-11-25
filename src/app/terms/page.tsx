import Link from "next/link";
import appConfig from "@/lib/config";
import { FileText, ArrowLeft } from "lucide-react";

export const metadata = {
  title: `Terms of Service — ${appConfig.companyName}`,
  description: "Terms and conditions governing the use of Pulse platforms.",
};

export default function TermsOfServicePage() {
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
            <FileText className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Terms of Service</h1>
            <p className="text-sm text-slate-500">Effective Date: November 2026</p>
          </div>
        </div>

        <div className="space-y-6 text-sm leading-relaxed text-slate-600">
          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-2">1. Agreement to Terms</h2>
            <p>
              By accessing or using the services provided by <strong>{appConfig.companyName}</strong>, you agree to
              comply with and be bound by these Terms of Service. If you are using the service on behalf of an
              employer or organization, you confirm that you have the authority to bind that entity to these terms.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-2">2. Acceptable Use</h2>
            <p>
              Users are strictly prohibited from attempting to bypass cryptographic tenant isolation, falsifying
              attendance punch records, submitting malicious payloads, or abusing administrative APIs. Rate limits
              and multi-factor authentication are enforced to preserve platform security.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-2">3. Service Availability</h2>
            <p>
              While {appConfig.companyName} endeavors to provide reliable access to attendance tracking and HR workflows,
              the software is provided on an &ldquo;as is&rdquo; and &ldquo;as available&rdquo; basis. Routine maintenance and updates
              will be scheduled with advance administrative notice where feasible.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-2">4. Support & Notices</h2>
            <p>
              Formal notices or support inquiries regarding these terms may be directed to our operations desk at{" "}
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
