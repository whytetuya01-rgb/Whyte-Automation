import { connectMongoDB } from "@/lib/mongodb";
import { Quotation, Product, Category, RoomType, HouseType, Company } from "@/models";
import ProposalBuilder from "@/components/proposal-builder/ProposalBuilder";
import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { ProposalStep } from "@/components/proposal-builder/StepIndicator";
import {
  normalizeQuotation,
  normalizeCategories,
  normalizeRoomTypes,
  normalizeHouseTypes,
  normalizeProducts,
} from "@/lib/quotationNormalization";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ step?: string }>;
};

export default async function QuotationPage(props: PageProps) {
  const session = await getServerSession(authOptions);
  if (!session) {
    redirect("/login");
  }

  const { id } = await props.params;
  const searchParams = await props.searchParams;

  await connectMongoDB();

  const [qDoc, htDocs, pDocs, cDocs, rtDocs, compDoc] = await Promise.all([
    Quotation.findById(id)
      .populate({ path: "houseType" })
      .populate({
        path: "rooms",
        options: { sort: { sortOrder: 1 } },
        populate: [
          { path: "roomType" },
          {
            path: "items",
            options: { sort: { sortOrder: 1 } },
            populate: [
              {
                path: "product",
                populate: {
                  path: "variants",
                  match: { isActive: true },
                },
              },
              {
                path: "productVariant",
              },
            ],
          },
        ],
      })
      .lean({ virtuals: true }),
    HouseType.find({ isActive: true })
      .sort({ sortOrder: 1 })
      .populate({
        path: "roomTemplate",
        options: { sort: { sortOrder: 1 } },
        populate: { path: "roomType" },
      })
      .lean({ virtuals: true }),
    Product.find({ isActive: true })
      .sort({ sortOrder: 1, createdAt: -1 })
      .populate({ path: "category" })
      .populate({
        path: "variants",
        match: { isActive: true },
        options: { sort: { sortOrder: 1 } },
      })
      .lean({ virtuals: true, getters: true }),
    Category.find({ level: 1 })
      .sort({ sortOrder: 1 })
      .populate({
        path: "children",
        options: { sort: { sortOrder: 1 } },
        populate: {
          path: "children",
          options: { sort: { sortOrder: 1 } },
        },
      })
      .lean({ virtuals: true }),
    RoomType.find({ isActive: true }).sort({ sortOrder: 1 }).lean({ virtuals: true }),
    Company.findOne().lean(),
  ]);

  if (!qDoc) {
    notFound();
  }

  const userRole = (session.user as any)?.role;
  const userId = Number((session.user as any)?.id);

  // IDOR Protection: Dealer can only view and edit their own quotations
  if (userRole === "dealer" && qDoc.dealerId !== userId) {
    notFound();
  }

  // Fast plain JSON normalization for client component hydration
  const quotation = normalizeQuotation(JSON.parse(JSON.stringify(qDoc)));
  const houseTypes = normalizeHouseTypes(JSON.parse(JSON.stringify(htDocs)));
  const products = normalizeProducts(pDocs);
  const categories = normalizeCategories(JSON.parse(JSON.stringify(cDocs)));
  const roomTypes = normalizeRoomTypes(JSON.parse(JSON.stringify(rtDocs)));
  const company = compDoc ? JSON.parse(JSON.stringify(compDoc)) : null;

  // Determine initial step: query param > rooms exist (Step 3) > Step 1
  let step: ProposalStep = 3;
  if (searchParams.step) {
    const parsed = parseInt(searchParams.step, 10);
    if (parsed >= 1 && parsed <= 5) {
      step = parsed as ProposalStep;
    }
  } else if (!quotation.rooms || quotation.rooms.length === 0) {
    step = 2;
  }

  return (
    <div className="w-full mx-auto py-1">
      <ProposalBuilder
        initialQuotation={quotation}
        initialHouseTypes={houseTypes}
        initialProducts={products}
        initialCategories={categories}
        initialRoomTypes={roomTypes}
        initialCompany={company}
        initialStep={step}
      />
    </div>
  );
}
