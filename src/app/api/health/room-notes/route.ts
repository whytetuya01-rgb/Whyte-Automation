import { NextResponse } from "next/server";
import { connectMongoDB } from "@/lib/mongodb";
import { QuotationRoom } from "@/models";
import { requireSession } from "@/lib/api-auth";
import { handleApiError } from "@/lib/api-response";

/**
 * Schema probe for the QuotationRoom `notes` field.
 *
 * Requires a session: it used to be public and returned a real room's notes,
 * which leaked customer content to anonymous callers. The payload now reports
 * only whether the field is queryable — no note text, no room id.
 */
export async function GET() {
  try {
    await requireSession();
    await connectMongoDB();

    // Projection only: this endpoint must never select the notes content.
    const room = await QuotationRoom.findOne({}, { _id: 1, notes: 1 }).lean();

    if (!room) {
      return NextResponse.json({
        status: "ok",
        message: "No rooms found to test, but the query succeeded.",
      });
    }

    return NextResponse.json({
      status: "ok",
      message: "Room notes field is queryable.",
      hasNotesField: Object.prototype.hasOwnProperty.call(room, "notes"),
      hasNotesValue: typeof room.notes === "string" && room.notes.length > 0,
    });
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/health/room-notes" });
  }
}
