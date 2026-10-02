import { connectMongoDB } from "@/lib/mongodb";
import { RoomType, HouseType, HouseTypeRoomTemplate } from "@/models";
import { getNextSequence } from "@/lib/counter";

export const INITIAL_ROOM_TYPES: Array<{ name: string; sortOrder: number }> = [
  { name: "Living Room", sortOrder: 1 },
  { name: "Master Bedroom", sortOrder: 2 },
  { name: "Bedroom", sortOrder: 3 },
  { name: "Bedroom 2", sortOrder: 4 },
  { name: "Bedroom 3", sortOrder: 5 },
  { name: "Kids Room", sortOrder: 6 },
  { name: "Guest Room", sortOrder: 7 },
  { name: "Kitchen", sortOrder: 8 },
  { name: "Dining Room", sortOrder: 9 },
  { name: "Balcony", sortOrder: 10 },
  { name: "Study Room", sortOrder: 11 },
  { name: "Home Office", sortOrder: 12 },
  { name: "Home Theatre", sortOrder: 13 },
  { name: "Entrance / Foyer", sortOrder: 14 },
  { name: "Utility Room", sortOrder: 15 },
  { name: "Terrace", sortOrder: 16 },
  { name: "Garden", sortOrder: 17 },
  { name: "Gym", sortOrder: 18 },
  { name: "Puja Room", sortOrder: 19 },
  { name: "Store Room", sortOrder: 20 },
  { name: "Corridor", sortOrder: 21 },
  { name: "Staircase", sortOrder: 22 },
  { name: "Common Area", sortOrder: 23 },
  { name: "Garage", sortOrder: 24 },
  { name: "Servant Room", sortOrder: 25 },
  { name: "Driver Room", sortOrder: 26 },
];

export const INITIAL_HOUSE_TYPE_ROOM_MAPPINGS: Record<
  string,
  Array<{ roomName: string; defaultCount: number; sortOrder: number }>
> = {
  "1 BHK": [
    { roomName: "Living Room", defaultCount: 1, sortOrder: 1 },
    { roomName: "Master Bedroom", defaultCount: 1, sortOrder: 2 },
    { roomName: "Kitchen", defaultCount: 1, sortOrder: 3 },
    { roomName: "Dining Room", defaultCount: 1, sortOrder: 4 },
    { roomName: "Balcony", defaultCount: 1, sortOrder: 5 },
  ],
  "2 BHK": [
    { roomName: "Living Room", defaultCount: 1, sortOrder: 1 },
    { roomName: "Master Bedroom", defaultCount: 1, sortOrder: 2 },
    { roomName: "Bedroom", defaultCount: 1, sortOrder: 3 },
    { roomName: "Kitchen", defaultCount: 1, sortOrder: 4 },
    { roomName: "Dining Room", defaultCount: 1, sortOrder: 5 },
    { roomName: "Balcony", defaultCount: 1, sortOrder: 6 },
  ],
  "3 BHK": [
    { roomName: "Living Room", defaultCount: 1, sortOrder: 1 },
    { roomName: "Master Bedroom", defaultCount: 1, sortOrder: 2 },
    { roomName: "Bedroom 2", defaultCount: 1, sortOrder: 3 },
    { roomName: "Bedroom 3", defaultCount: 1, sortOrder: 4 },
    { roomName: "Kitchen", defaultCount: 1, sortOrder: 5 },
    { roomName: "Dining Room", defaultCount: 1, sortOrder: 6 },
    { roomName: "Balcony", defaultCount: 2, sortOrder: 7 },
    { roomName: "Entrance / Foyer", defaultCount: 1, sortOrder: 8 },
  ],
  "4 BHK": [
    { roomName: "Living Room", defaultCount: 1, sortOrder: 1 },
    { roomName: "Master Bedroom", defaultCount: 1, sortOrder: 2 },
    { roomName: "Bedroom 2", defaultCount: 1, sortOrder: 3 },
    { roomName: "Bedroom 3", defaultCount: 1, sortOrder: 4 },
    { roomName: "Guest Room", defaultCount: 1, sortOrder: 5 },
    { roomName: "Kitchen", defaultCount: 1, sortOrder: 6 },
    { roomName: "Dining Room", defaultCount: 1, sortOrder: 7 },
    { roomName: "Balcony", defaultCount: 2, sortOrder: 8 },
    { roomName: "Study Room", defaultCount: 1, sortOrder: 9 },
    { roomName: "Entrance / Foyer", defaultCount: 1, sortOrder: 10 },
  ],
  "Duplex": [
    { roomName: "Living Room", defaultCount: 1, sortOrder: 1 },
    { roomName: "Master Bedroom", defaultCount: 1, sortOrder: 2 },
    { roomName: "Bedroom", defaultCount: 1, sortOrder: 3 },
    { roomName: "Kitchen", defaultCount: 1, sortOrder: 4 },
    { roomName: "Dining Room", defaultCount: 1, sortOrder: 5 },
    { roomName: "Balcony", defaultCount: 2, sortOrder: 6 },
    { roomName: "Staircase", defaultCount: 1, sortOrder: 7 },
    { roomName: "Terrace", defaultCount: 1, sortOrder: 8 },
    { roomName: "Entrance / Foyer", defaultCount: 1, sortOrder: 9 },
  ],
  "Villa": [
    { roomName: "Living Room", defaultCount: 1, sortOrder: 1 },
    { roomName: "Master Bedroom", defaultCount: 1, sortOrder: 2 },
    { roomName: "Bedroom 2", defaultCount: 1, sortOrder: 3 },
    { roomName: "Guest Room", defaultCount: 1, sortOrder: 4 },
    { roomName: "Kitchen", defaultCount: 1, sortOrder: 5 },
    { roomName: "Dining Room", defaultCount: 1, sortOrder: 6 },
    { roomName: "Home Theatre", defaultCount: 1, sortOrder: 7 },
    { roomName: "Garden", defaultCount: 1, sortOrder: 8 },
    { roomName: "Balcony", defaultCount: 2, sortOrder: 9 },
    { roomName: "Entrance / Foyer", defaultCount: 1, sortOrder: 10 },
  ],
  "Penthouse": [
    { roomName: "Living Room", defaultCount: 1, sortOrder: 1 },
    { roomName: "Master Bedroom", defaultCount: 1, sortOrder: 2 },
    { roomName: "Bedroom 2", defaultCount: 1, sortOrder: 3 },
    { roomName: "Bedroom 3", defaultCount: 1, sortOrder: 4 },
    { roomName: "Kitchen", defaultCount: 1, sortOrder: 5 },
    { roomName: "Dining Room", defaultCount: 1, sortOrder: 6 },
    { roomName: "Terrace", defaultCount: 1, sortOrder: 7 },
    { roomName: "Home Theatre", defaultCount: 1, sortOrder: 8 },
    { roomName: "Balcony", defaultCount: 2, sortOrder: 9 },
    { roomName: "Entrance / Foyer", defaultCount: 1, sortOrder: 10 },
  ],
};

let isRoomDataSeeded = false;

/**
 * Idempotently ensures standard RoomTypes and HouseTypeRoomTemplates are seeded in MongoDB.
 * If data already exists, this is a fast in-memory no-op.
 */
export async function ensureRoomTypesAndTemplatesSeeded(): Promise<void> {
  if (isRoomDataSeeded) return;

  await connectMongoDB();

  const roomTypeCount = await RoomType.countDocuments();
  if (roomTypeCount === 0) {
    console.log("[Auto-Seed] Seeding default RoomTypes...");
    for (const rt of INITIAL_ROOM_TYPES) {
      const nextId = await getNextSequence("roomType", RoomType);
      await RoomType.create({
        _id: nextId,
        name: rt.name,
        icon: null,
        isActive: true,
        sortOrder: rt.sortOrder,
      });
    }
    console.log(`[Auto-Seed] Successfully seeded ${INITIAL_ROOM_TYPES.length} RoomTypes.`);
  }

  const templateCount = await HouseTypeRoomTemplate.countDocuments();
  if (templateCount === 0) {
    console.log("[Auto-Seed] Seeding HouseTypeRoomTemplates...");
    const allRoomTypes = await RoomType.find();
    const roomMap = new Map<string, number>();
    allRoomTypes.forEach((rt) => {
      roomMap.set(rt.name.trim().toLowerCase(), rt._id);
    });

    const houseTypes = await HouseType.find();
    for (const ht of houseTypes) {
      const mappings = INITIAL_HOUSE_TYPE_ROOM_MAPPINGS[ht.name];
      if (mappings) {
        for (const m of mappings) {
          const roomTypeId = roomMap.get(m.roomName.toLowerCase());
          if (roomTypeId) {
            const nextTemplateId = await getNextSequence(
              "houseTypeRoomTemplate",
              HouseTypeRoomTemplate
            );
            await HouseTypeRoomTemplate.create({
              _id: nextTemplateId,
              houseTypeId: ht._id,
              roomTypeId,
              defaultCount: m.defaultCount,
              sortOrder: m.sortOrder,
            });
          }
        }
      }
    }
    console.log("[Auto-Seed] Successfully seeded HouseTypeRoomTemplates.");
  }

  isRoomDataSeeded = true;
}
