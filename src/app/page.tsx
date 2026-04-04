import Link from "next/link";

const PSPM_PHONE = process.env.NEXT_PUBLIC_PSPM_PHONE ?? "512-251-6122";
const PSPM_ADDRESS =
  process.env.NEXT_PUBLIC_PSPM_ADDRESS ??
  "1490 Rusk Rd, Ste. 301, Round Rock, TX 78665";

interface FormCard {
  title: string;
  description: string;
  href: string;
  status: "live" | "coming-soon";
}

const forms: FormCard[] = [
  {
    title: "Contact Us",
    description:
      "Get in touch with our Customer Service, Accounting, or Maintenance teams.",
    href: "/contact",
    status: "live",
  },
  {
    title: "Request a Management Proposal",
    description:
      "Submit a proposal request for HOA or Condo Association management services.",
    href: "/proposal",
    status: "live",
  },
  {
    title: "Invoicing System",
    description: "Submit invoices with PDF generation and preview.",
    href: "/invoice",
    status: "coming-soon",
  },
  {
    title: "Vendor Application",
    description: "Apply to become a PSPM-approved vendor.",
    href: "/vendor-apply",
    status: "coming-soon",
  },
  {
    title: "Falcon Pointe Portal Request",
    description: "Submit ARC requests and community portal inquiries.",
    href: "/portal/falcon-pointe",
    status: "coming-soon",
  },
  {
    title: "Reservation - Indoor Gathering Room",
    description: "Reserve the indoor gathering room with payment.",
    href: "/reserve/indoor",
    status: "coming-soon",
  },
];

export default function HomePage() {
  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      {/* Header */}
      <header className="bg-primary shadow-sm">
        <div className="max-w-5xl mx-auto px-4 py-6 sm:px-6">
          <div className="flex flex-col">
            <h1 className="text-2xl font-bold text-white tracking-tight">
              PS Property Management
            </h1>
            <p className="text-sm text-white/70 mt-1">Online Forms</p>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 w-full max-w-5xl mx-auto px-4 py-10 sm:px-6">
        <div className="mb-8">
          <h2 className="text-xl font-bold text-navy">Available Forms</h2>
          <p className="text-sm text-muted mt-1">
            Select a form below to get started.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {forms.map((form) => (
            <FormCardComponent key={form.href} form={form} />
          ))}
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-navy text-white/80 text-xs py-6">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 text-center space-y-1">
          <p className="font-medium text-white">PS Property Management</p>
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

function FormCardComponent({ form }: { form: FormCard }) {
  const isLive = form.status === "live";

  if (!isLive) {
    return (
      <div className="rounded-xl border border-border bg-white p-5 opacity-60">
        <div className="flex items-start justify-between gap-2 mb-2">
          <h3 className="text-base font-semibold text-navy">{form.title}</h3>
          <span className="shrink-0 text-[10px] font-medium uppercase tracking-wider text-muted bg-gray-100 rounded-full px-2 py-0.5">
            Coming Soon
          </span>
        </div>
        <p className="text-sm text-muted">{form.description}</p>
      </div>
    );
  }

  return (
    <Link
      href={form.href}
      className="group rounded-xl border border-border bg-white p-5 transition-all hover:shadow-md hover:border-primary/30 no-underline"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <h3 className="text-base font-semibold text-navy group-hover:text-primary transition-colors">
          {form.title}
        </h3>
        <span className="shrink-0 text-[10px] font-medium uppercase tracking-wider text-brand-green bg-brand-green/10 rounded-full px-2 py-0.5">
          Live
        </span>
      </div>
      <p className="text-sm text-muted">{form.description}</p>
      <div className="mt-3 flex items-center text-sm font-medium text-primary">
        Open form
        <svg
          className="w-4 h-4 ml-1 group-hover:translate-x-0.5 transition-transform"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 5l7 7-7 7"
          />
        </svg>
      </div>
    </Link>
  );
}
