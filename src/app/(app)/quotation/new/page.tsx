import { connectMongoDB } from "@/lib/mongodb";
import { HouseType, RoomType } from "@/models";
import ProposalBuilder from "@/components/proposal-builder/ProposalBuilder";

export const dynamic = "force-dynamic";

export default async function NewQuotationPage() {
  await connectMongoDB();
  const [htDocs, rtDocs] = await Promise.all([
    HouseType.find({ isActive: true })
      .sort({ sortOrder: 1 })
      .populate({
        path: "roomTemplate",
        options: { sort: { sortOrder: 1 } },
        populate: { path: "roomType" },
      }),
    RoomType.find({ isActive: true }).sort({ sortOrder: 1 }),
  ]);

  const houseTypes = JSON.parse(JSON.stringify(htDocs));
  const roomTypes = JSON.parse(JSON.stringify(rtDocs));

  return (
    <ProposalBuilder
      initialStep={1}
      initialHouseTypes={houseTypes}
      initialRoomTypes={roomTypes}
    />
  );
}
