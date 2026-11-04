import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import RevisionViewer from "@/components/proposal-builder/revisions/RevisionViewer";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string; from?: string; to?: string }>;
};

const revisionNumber = (value: string | undefined): number | null => {
  const n = Number(value);
  return value && Number.isInteger(n) && n >= 1 ? n : null;
};

/**
 * /quotation/[id]/revisions — a quotation's issued revisions: ?view=2 shows one revision's original PDF, ?from=1&to=3 compares
 * two. Who may see what is decided by the revision APIs this page reads (the same rules as the quotation itself).
 */
export default async function QuotationRevisionsPage(props: PageProps) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  const { id } = await props.params;
  const query = await props.searchParams;
  return <RevisionViewer quotationId={id} initialView={revisionNumber(query.view)} initialFrom={revisionNumber(query.from)} initialTo={revisionNumber(query.to)} />;
}
