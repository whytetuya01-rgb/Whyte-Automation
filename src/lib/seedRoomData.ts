import { connectMongoDB } from "@/lib/mongodb";
import { RoomType, HouseType, HouseTypeRoomTemplate } from "@/models";
import { getNextSequence } from "@/lib/counter";
import { getTenantContext } from "@/lib/tenant/context";

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

/** Companies already initialised by THIS process (a fast path only; the database check below is the source of truth). */
const seededCompanies = new Set<number>();
/** One in-flight initialisation per company, so two simultaneous requests in a process cannot both seed. */
const inFlight = new Map<number, Promise<void>>();

const norm = (name: string) => name.trim().toLowerCase();

/**
 * Idempotently ensures the CALLING company has the standard RoomTypes and HouseTypeRoomTemplates.
 *
 * - It acts only inside an active company context. With no company (a Super Admin who has not selected
 *   "Act as Company", or no context at all) it does NOTHING: it never creates records, never bypasses tenant
 *   scoping and never picks a company on anyone's behalf. Callers that must answer such a request should use
 *   `requireActiveCompany` (api-auth) before calling this.
 * - Initialisation is per company. (It used to be one process-wide flag, so after the first company was seeded no
 *   other company would ever be.)
 * - A company that already has any room type is left alone, and a missing standard room type is only created if
 *   no room type with that name exists yet, so a rerun or a partial earlier run never adds duplicates.
 */
export async function ensureRoomTypesAndTemplatesSeeded(): Promise<void> {
  const companyId = getTenantContext()?.companyId ?? null;
  if (companyId === null) return;
  if (seededCompanies.has(companyId)) return;
  const running = inFlight.get(companyId);
  if (running) return running;
  const job = seedCompany(companyId).then(
    () => { seededCompanies.add(companyId); inFlight.delete(companyId); },
    (error) => { inFlight.delete(companyId); throw error; }
  );
  inFlight.set(companyId, job);
  return job;
}

async function seedCompany(companyId: number): Promise<void> {
  await connectMongoDB();

  const roomTypeCount = await RoomType.countDocuments();
  if (roomTypeCount === 0) {
    console.log(`[Auto-Seed] Seeding default RoomTypes for company ${companyId}...`);
    const have = new Set((await RoomType.find().select("name").lean()).map((r) => norm(String(r.name))));
    let created = 0;
    for (const rt of INITIAL_ROOM_TYPES) {
      if (have.has(norm(rt.name))) continue;
      const nextId = await getNextSequence("roomType", RoomType);
      await RoomType.create({ _id: nextId, name: rt.name, icon: null, isActive: true, sortOrder: rt.sortOrder });
      have.add(norm(rt.name));
      created += 1;
    }
    console.log(`[Auto-Seed] Seeded ${created} RoomTypes for company ${companyId}.`);
  }

  const templateCount = await HouseTypeRoomTemplate.countDocuments();
  if (templateCount === 0) {
    const houseTypes = await HouseType.find();
    if (houseTypes.length === 0) return; // nothing to attach templates to; a later request retries
    console.log(`[Auto-Seed] Seeding HouseTypeRoomTemplates for company ${companyId}...`);
    const allRoomTypes = await RoomType.find();
    const roomMap = new Map<string, number>();
    allRoomTypes.forEach((rt) => {
      roomMap.set(norm(rt.name), rt._id);
    });

    for (const ht of houseTypes) {
      const mappings = INITIAL_HOUSE_TYPE_ROOM_MAPPINGS[ht.name];
      if (!mappings) continue;
      const existing = new Set(
        (await HouseTypeRoomTemplate.find({ houseTypeId: ht._id }).select("roomTypeId").lean()).map((t) => t.roomTypeId)
      );
      for (const m of mappings) {
        const roomTypeId = roomMap.get(norm(m.roomName));
        if (!roomTypeId || existing.has(roomTypeId)) continue;
        const nextTemplateId = await getNextSequence("houseTypeRoomTemplate", HouseTypeRoomTemplate);
        await HouseTypeRoomTemplate.create({
          _id: nextTemplateId,
          houseTypeId: ht._id,
          roomTypeId,
          defaultCount: m.defaultCount,
          sortOrder: m.sortOrder,
        });
      }
    }
    console.log(`[Auto-Seed] Seeded HouseTypeRoomTemplates for company ${companyId}.`);
  }
}
