import { Mail, Phone } from "lucide-react";
import type { FooterCompany } from "@/lib/footerCompany";
import { cn } from "@/lib/utils";

interface SiteFooterProps {
  company: FooterCompany;
  /** `public` = dealer/quotation panel (white), `admin` = compact bar inside the admin content area. */
  variant: "public" | "admin";
}

function ContactLinks({ company, className }: { company: FooterCompany; className?: string }) {
  if (!company.phone && !company.email) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-1.5", className)}>
      {company.phone && (
        <a
          href={`tel:${company.phone.replace(/[^\d+]/g, "")}`}
          className="inline-flex items-center gap-1.5 transition-colors hover:text-[#D85B83]"
        >
          <Phone size={12} aria-hidden="true" />
          <span>{company.phone}</span>
        </a>
      )}
      {company.email && (
        <a
          href={`mailto:${company.email}`}
          className="inline-flex min-w-0 items-center gap-1.5 transition-colors hover:text-[#D85B83]"
        >
          <Mail size={12} aria-hidden="true" />
          <span className="truncate">{company.email}</span>
        </a>
      )}
    </div>
  );
}

export default function SiteFooter({ company, variant }: SiteFooterProps) {
  const year = new Date().getFullYear();

  if (variant === "admin") {
    return (
      <footer className="mt-auto border-t border-neutral-200/80 px-3.5 py-3 text-[11px] text-neutral-500 sm:px-5 md:px-6 xl:px-8">
        <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {year} {company.name}. All rights reserved.
          </p>
          <ContactLinks company={company} />
        </div>
      </footer>
    );
  }

  return (
    <footer className="mt-auto border-t border-gray-100 bg-white text-xs text-gray-500">
      <div className="mx-auto flex max-w-[95%] 2xl:max-w-[1760px] flex-col gap-2.5 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between md:px-6 lg:px-8">
        <div className="flex flex-wrap items-center gap-x-2.5">
          <span>
            © {year} {company.name}. All rights reserved.
          </span>
          {company.tagline && (
            <>
              <span className="hidden sm:inline text-gray-300">•</span>
              <span className="hidden sm:inline text-gray-400">{company.tagline}</span>
            </>
          )}
        </div>
        <ContactLinks company={company} className="text-gray-500" />
      </div>
    </footer>
  );
}

