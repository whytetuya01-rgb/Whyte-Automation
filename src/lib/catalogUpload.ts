import { ApiError } from "@/lib/api-response";
import { MAX_FILE_BYTES, assertSafeXlsx } from "@/lib/catalogSheetXlsx";

/** The uploaded .xlsx (and any text fields) of a multipart request, size- and shape-checked before anything parses it. */
export async function readXlsxUpload(req: Request): Promise<{ buffer: Buffer; fields: Map<string, string> }> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > MAX_FILE_BYTES + 64 * 1024) throw new ApiError("VALIDATION_ERROR", `The file is too large: ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB at most.`, { field: "file" });
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new ApiError("VALIDATION_ERROR", "Expected a multipart/form-data upload with a file.", { field: "file" });
  }
  const file = form.get("file");
  if (!(file instanceof File)) throw new ApiError("VALIDATION_ERROR", "Choose an Excel (.xlsx) file.", { field: "file" });
  if (!/\.xlsx$/i.test(file.name)) throw new ApiError("VALIDATION_ERROR", "Only Excel .xlsx files can be imported. Save the sheet as .xlsx and retry.", { field: "file" });
  if (file.size > MAX_FILE_BYTES) throw new ApiError("VALIDATION_ERROR", `The file is too large: ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB at most.`, { field: "file" });
  const buffer = Buffer.from(await file.arrayBuffer());
  assertSafeXlsx(buffer);
  const fields = new Map<string, string>();
  for (const [key, value] of form.entries()) if (typeof value === "string") fields.set(key, value);
  return { buffer, fields };
}
