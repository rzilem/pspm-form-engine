"use client";

import Link from "next/link";

interface FormLayoutProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}

const PSPM_PHONE = process.env.NEXT_PUBLIC_PSPM_PHONE ?? "512-251-6122";
const PSPM_WEBSITE = process.env.NEXT_PUBLIC_PSPM_WEBSITE ?? "psprop.net";
const PSPM_ADDRESS =
  process.env.NEXT_PUBLIC_PSPM_ADDRESS ??
  "1490 Rusk Rd, Ste. 301, Round Rock, TX 78665";

function FormLayout({ title, subtitle, children }: FormLayoutProps) {
  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      {/* Header */}
      <header className="bg-primary shadow-sm">
        <div className="max-w-3xl mx-auto px-4 py-4 sm:px-6">
          <Link
            href="/"
            className="flex items-center gap-3 text-white no-underline"
            aria-label="PS Property Management - Back to forms"
          >
            {/* Logo placeholder — replace <div> with <img> when ready */}
            <div className="flex flex-col">
              <span className="text-lg font-bold tracking-tight leading-tight">
                PS Property Management
              </span>
              <span className="text-xs text-white/70">
                {PSPM_PHONE} | {PSPM_WEBSITE}
              </span>
            </div>
          </Link>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 w-full max-w-3xl mx-auto px-4 py-8 sm:px-6">
        <div className="bg-white rounded-[12px] shadow-sm border border-border p-6 sm:p-8">
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-navy">{title}</h1>
            {subtitle && (
              <p className="mt-1 text-sm text-muted">{subtitle}</p>
            )}
          </div>
          {children}
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-navy text-white/80 text-xs py-6">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center space-y-1">
          <p className="font-medium text-white">PS Property Management</p>
          <p>Serving Central Texas communities since 1987</p>
          <p>{PSPM_ADDRESS}</p>
          <p>Phone: {PSPM_PHONE}</p>
          <p className="pt-2 text-white/50">
            &copy; {new Date().getFullYear()} PS Property Management. All rights
            reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}

export { FormLayout };
export type { FormLayoutProps };
