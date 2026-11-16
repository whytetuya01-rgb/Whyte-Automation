import ExcelJS from "exceljs";
import type { Customer } from "@/types/crm";
import { CUSTOMER_TYPE_LABELS } from "@/types/crm";

/**
 * Generates and downloads a beautifully styled Excel (.xlsx) spreadsheet of customers.
 */
export async function exportCustomersToExcel(customers: Customer[], filename = "customers-export.xlsx") {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Whyte CRM";
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet("Customers", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  // Define Columns
  worksheet.columns = [
    { header: "ID", key: "id", width: 10 },
    { header: "Customer Name", key: "name", width: 26 },
    { header: "Category", key: "customerType", width: 22 },
    { header: "Company / Firm", key: "companyName", width: 24 },
    { header: "Designation", key: "designation", width: 20 },
    { header: "Phone", key: "phone", width: 16 },
    { header: "WhatsApp", key: "whatsapp", width: 16 },
    { header: "Email", key: "email", width: 26 },
    { header: "GST Number", key: "gstNumber", width: 18 },
    { header: "Site Address", key: "siteAddress", width: 32 },
    { header: "Billing Address", key: "billingAddress", width: 32 },
    { header: "Tags", key: "tags", width: 22 },
    { header: "Quotations Count", key: "quotationsCount", width: 16 },
    { header: "Account Lead", key: "accountLead", width: 20 },
    { header: "Created Date", key: "createdAt", width: 18 },
  ];

  // Header Styling
  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1E293B" }, // Slate 800
  };
  headerRow.alignment = { vertical: "middle", horizontal: "center" };
  headerRow.height = 26;

  // Add Rows
  customers.forEach((c) => {
    const row = worksheet.addRow({
      id: c.id,
      name: c.name || "—",
      customerType: CUSTOMER_TYPE_LABELS[c.customerType] || c.customerType || "Individual",
      companyName: c.companyName || "—",
      designation: c.designation || "—",
      phone: c.phone || "—",
      whatsapp: c.whatsapp || c.phone || "—",
      email: c.email || "—",
      gstNumber: c.gstNumber || "—",
      siteAddress: c.siteAddress || "—",
      billingAddress: c.billingAddress || "—",
      tags: Array.isArray(c.tags) && c.tags.length > 0 ? c.tags.join(", ") : "—",
      quotationsCount: c.quotationsCount ?? 0,
      accountLead: c.assignedSales?.name || c.dealer?.companyName || "Direct",
      createdAt: c.createdAt ? new Date(c.createdAt).toLocaleDateString("en-IN") : "—",
    });

    row.alignment = { vertical: "middle" };
    row.height = 20;
  });

  // Alternate row background for readability
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1 && rowNumber % 2 === 0) {
      row.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFF8FAFC" }, // Slate 50
      };
    }
  });

  // Write and trigger download
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

