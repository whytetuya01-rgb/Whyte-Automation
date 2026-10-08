import { NextResponse } from "next/server";
import { connectMongoDB } from "@/lib/mongodb";
import { Category } from "@/models";
import { getNextSequence } from "@/lib/counter";
import { requireRole, requireSession } from "@/lib/api-auth";
import {
  ApiError,
  apiSuccess,
  asObjectBody,
  handleApiError,
  readJsonBody,
} from "@/lib/api-response";

import { normalizeCategories } from "@/lib/quotationNormalization";

const MAX_DEPTH = 3;

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireSession();

    await connectMongoDB();
    const categories = await Category.find({ level: 1 })
      .sort({ sortOrder: 1 })
      .populate({
        path: "children",
        options: { sort: { sortOrder: 1 } },
        populate: {
          path: "children",
          options: { sort: { sortOrder: 1 } },
        },
      })
      .lean({ virtuals: true });

    return NextResponse.json(normalizeCategories(categories));
  } catch (error) {
    return handleApiError(error, { logPrefix: "GET /api/categories" });
  }
}

export async function POST(req: Request) {
  try {
    // Catalog master data writes are restricted to Super Admin / Admin.
    await requireRole("super_admin", "admin");

    await connectMongoDB();
    const body = asObjectBody(await readJsonBody(req));
    const { name, level, parentId, sortOrder } = body;

    // Validate required fields
    if (!name || typeof name !== "string" || !name.trim()) {
      throw new ApiError("REQUIRED_FIELD", "Name is required.", { field: "name" });
    }
    if (typeof level !== "number" || level < 1 || level > MAX_DEPTH) {
      throw new ApiError("INVALID_FIELD", `Level must be between 1 and ${MAX_DEPTH}.`, {
        field: "level",
      });
    }

    // L1 must have no parent
    if (level === 1 && parentId) {
      throw new ApiError("VALIDATION_ERROR", "Series (level 1) cannot have a parent.", {
        field: "parentId",
      });
    }

    // L2+ must have a parent
    if (level > 1 && !parentId) {
      throw new ApiError("REQUIRED_FIELD", `Level ${level} category requires a parent.`, {
        field: "parentId",
      });
    }

    // Validate parent exists and level is consistent
    if (parentId) {
      const parent = await Category.findById(parentId, { level: 1 });
      if (!parent) {
        throw new ApiError("NOT_FOUND", "Parent category not found.", { field: "parentId" });
      }
      if (parent.level !== level - 1) {
        throw new ApiError(
          "VALIDATION_ERROR",
          `Level mismatch: parent is level ${parent.level}, child must be level ${parent.level + 1}.`,
          { field: "parentId" }
        );
      }
    }

    // Category master data is not unique-by-name, but a same-level sibling with
    // the same name is always a mistake. Application-level check, no DB index.
    const nameTrimmed = name.trim();
    const siblingQuery = parentId
      ? { parentId, name: nameTrimmed }
      : { parentId: null, name: nameTrimmed };
    const sibling = await Category.findOne(siblingQuery).select("_id").lean();
    if (sibling) {
      throw new ApiError("DUPLICATE_RECORD", `A category named '${nameTrimmed}' already exists here.`, {
        field: "name",
      });
    }

    const nextId = await getNextSequence("category", Category);
    const parentIdNum = parentId === null || parentId === undefined ? null : Number(parentId);
    const sortOrderNum = sortOrder === null || sortOrder === undefined ? 0 : Number(sortOrder);

    if (parentIdNum !== null && !Number.isFinite(parentIdNum)) {
      throw new ApiError("INVALID_FIELD", "Parent category must be a numeric id.", {
        field: "parentId",
      });
    }
    if (!Number.isFinite(sortOrderNum)) {
      throw new ApiError("INVALID_FIELD", "Sort order must be a number.", { field: "sortOrder" });
    }

    const category = await Category.create({
      _id: nextId,
      name: nameTrimmed,
      level,
      parentId: parentIdNum,
      sortOrder: sortOrderNum,
      // Stored exactly as submitted. Category master data is not reshaped by this
      // endpoint: the existing master rows keep their representation and new rows
      // keep whatever the admin UI sent (plain strings or { value, label }).
      variantTiers: body.variantTiers ?? [],
      variantFinishes: body.variantFinishes ?? [],
    });

    return apiSuccess(category, { status: 201 });
  } catch (error) {
    return handleApiError(error, { logPrefix: "POST /api/categories" });
  }
}
