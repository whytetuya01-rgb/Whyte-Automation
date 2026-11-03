import ExcelJS from "exceljs";
import { ApiError } from "@/lib/api-response";
import { COLUMNS } from "@/lib/catalogSheet";

/**
 * Reading and writing the catalogue's .xlsx files. An uploaded file is untrusted: it is size-limited, must be a real zip, and its
 * declared uncompressed size is checked BEFORE it is opened, so a tiny file that unpacks to gigabytes (a "zip bomb") is refused.
 */

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 200;
const MAX_UNCOMPRESSED_BYTES = 60 * 1024 * 1024;
export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const bad = (message: string) => new ApiError("VALIDATION_ERROR", message, { field: "file" });

/** Refuses anything that is not a modest, ordinary .xlsx (a zip) before a parser sees it. */
export function assertSafeXlsx(buffer: Buffer): void {
  if (buffer.length === 0) throw bad("The file is empty.");
  if (buffer.length > MAX_FILE_BYTES) throw bad(`The file is too large: ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB at most.`);
  if (buffer.readUInt32LE(0) !== 0x04034b50) throw bad("That is not an Excel (.xlsx) file.");

  // End of central directory record: the last 22..65557 bytes.
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65_557); i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw bad("That is not a valid Excel (.xlsx) file.");
  const entries = buffer.readUInt16LE(eocd + 10);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  if (entries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) throw bad("That Excel file format is not supported.");
  if (entries > MAX_ZIP_ENTRIES) throw bad("That Excel file has too many parts.");

  let offset = centralOffset;
  let total = 0;
  for (let n = 0; n < entries; n += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) throw bad("That is not a valid Excel (.xlsx) file.");
    total += buffer.readUInt32LE(offset + 24);
    if (total > MAX_UNCOMPRESSED_BYTES) throw bad("That Excel file expands to too much data.");
    offset += 46 + buffer.readUInt16LE(offset + 28) + buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32);
  }
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    const object = value as unknown as Record<string, unknown>;
    if (Array.isArray(object.richText)) return (object.richText as Array<{ text?: string }>).map((part) => part.text ?? "").join("");
    if ("result" in object) return cellText(object.result as ExcelJS.CellValue); // a formula: its value
    if (typeof object.text === "string") return object.text; // a hyperlink
    if (typeof object.error === "string") return "";
  }
  return String(value);
}

/** The first worksheet as a table of texts (row 1 is the header). */
export async function readWorkbook(buffer: Buffer): Promise<string[][]> {
  assertSafeXlsx(buffer);
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw bad("That Excel file could not be read. Save it again as .xlsx and retry.");
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) throw bad("That Excel file has no sheets.");
  const table: string[][] = [];
  const width = Math.min(sheet.columnCount, 60);
  sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    if (rowNumber > 20_000) return;
    const cells: string[] = [];
    for (let c = 1; c <= width; c += 1) cells.push(cellText(row.getCell(c).value).trim());
    table[rowNumber - 1] = cells;
  });
  return Array.from(table, (row) => row ?? []);
}

export async function writeWorkbook(table: ReadonlyArray<ReadonlyArray<string | number | boolean | null>>, options: { withHelp?: boolean } = {}): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Whyte Catalogue";
  const sheet = workbook.addWorksheet("Products", { views: [{ state: "frozen", ySplit: 1 }] });
  table.forEach((row) => sheet.addRow([...row]));
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF111111" } };
  sheet.columns.forEach((column, index) => {
    const headerText = String(table[0]?.[index] ?? "");
    column.width = Math.max(14, Math.min(40, headerText.length + 6));
  });
  if (options.withHelp) {
    const help = workbook.addWorksheet("How to fill this in");
    help.addRow(["Column", "Required", "What to enter"]).font = { bold: true };
    for (const column of COLUMNS) help.addRow([column.header, column.required ? "Yes" : "", column.help]);
    help.addRow([]);
    help.addRow(["One row per VARIANT. Products and variants are matched by code. A blank cell on an existing product or variant leaves it as it is. Nothing is ever deleted, and quotations already issued are never changed."]);
    help.getColumn(1).width = 22;
    help.getColumn(2).width = 10;
    help.getColumn(3).width = 100;
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
