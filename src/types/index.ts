export type ProductType = "switch_board" | "accessory" | "curtain" | "smart_lock" | "vdp" | "other";

/** A single option in a category's variant dimension. e.g. { value: "wifi", label: "WiFi Smart" } */
export interface VariantOption {
  value: string;
  label: string;
}
export type QuotationStatus = "draft" | "sent" | "approved" | "rejected" | "delivered";
export type DiscountType = "percentage" | "fixed" | "none";
export type AdminRole = "super_admin" | "admin" | "dealer";

export interface Category {
  id: number;
  name: string;
  level: number;
  parentId: number | null;
  parent?: Category | null;
  sortOrder: number;
  isActive: boolean;
  children?: Category[];
  products?: Product[];
  variantTiers?: VariantOption[] | null;
  variantFinishes?: VariantOption[] | null;
}

/**
 * One axis of a matrix product.
 * e.g. { key: "series", label: "Series", options: ["wifi", "zigbee"] }
 */
export interface MatrixDimension {
  key: string;
  label: string;
  options: string[];
}

/**
 * A single pricing variant. config holds N-dim key→value pairs.
 * e.g. { series: "wifi", finish: "glass" } for a 2D switch board.
 * Empty config {} for flat (single-price) products.
 */
export interface ProductVariant {
  id: number;
  productId: number;
  variantCode?: string | null;
  name?: string | null;
  code?: string | null;
  automationTier: string | null;
  surfaceFinish: string | null;
  tierLabel?: string | null;
  finishLabel?: string | null;
  config?: Record<string, string>;
  priceWithoutTax?: string;
  taxPercent?: string;
  taxAmount?: string;
  price: string;                  // final selling price INCLUDING tax
  cost?: string;
  purchaseTaxPercent?: string;
  isActive: boolean;
  sortOrder: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface Product {
  id: number;
  name: string;
  code: string | null;
  description: string | null;
  type: ProductType;
  categoryId: number | null;
  category?: Category;
  automationTier?: string | null;
  surfaceFinish?: string | null;
  price?: string;                 // optional legacy display field; variant is source of truth
  unit: string;
  imageUrl: string | null;
  imagePublicId?: string | null;
  moduleSize?: string | null;
  notes: string | null;
  isActive: boolean;
  sortOrder: number;
  createdAt?: string;
  updatedAt?: string;
  // Matrix pricing (NEW)
  isMatrix: boolean;
  matrixDimensions: MatrixDimension[] | null;
  variants?: ProductVariant[];
}

export interface QuotationItem {
  id: number;
  quotationRoomId: number;
  productId: number;
  product?: Product;
  productVariantId: number | null;
  productVariant?: ProductVariant | null;
  variantLabel: string | null;
  variantConfig: Record<string, string> | null; // config snapshot
  sbNumber: string | null;
  quantity: number;
  unitPrice: string;
  priceWithoutTax?: string;
  taxPercent?: string;
  taxAmount?: string;
  linePrice?: number;
  notes: string | null;
  sortOrder: number;
}

export interface QuotationRoom {
  id: number;
  quotationId: string;
  roomTypeId: number | null;
  roomType?: { id: number; name: string; icon: string | null };
  customName: string | null;
  subArea: string | null;
  notes: string | null;
  sortOrder: number;
  items: QuotationItem[];
  subtotal?: number;
  productsCount?: number;
}

export interface Quotation {
  id: string;
  quotationNumber: string;
  clientName: string;
  clientGstNumber: string | null;
  clientPhone: string | null;
  clientEmail: string | null;
  clientAddress: string | null;
  houseTypeId: number | null;
  houseType?: { id: number; name: string };
  status: QuotationStatus;
  notes: string | null;
  discountType: DiscountType | null;
  discountValue: string | null;
  discountAmount?: number;
  subtotal?: number;
  netSubtotal?: number;
  cgstPercent?: number;
  cgstAmount?: number;
  sgstPercent?: number;
  sgstAmount?: number;
  totalGstAmount?: number;
  totalAmount?: number;
  grandTotal?: number;
  productsCount?: number;
  totalProducts?: number;
  earningPercent?: number;
  estimatedEarning?: number;
  allocatedDiscountPercent?: number | null;
  customerDiscountPercent?: number | null;
  estimatedEarningPercent?: number | null;
  estimatedEarningAmount?: string | number | null;
  dealerId?: number | null;
  dealer?: AdminUser | null;
  assignedSalesId?: number | null;
  assignedSales?: AdminUser | null;
  sentAt?: string | null;
  sentBy?: number | null;
  approvedAt?: string | null;
  approvedBy?: number | null;
  rejectedAt?: string | null;
  rejectedBy?: number | null;
  deliveredAt?: string | null;
  deliveredBy?: number | null;
  clonedFromQuotationId?: string | null;
  terms: string | null;
  validUntil: string | null;
  defaultTier: string | null;
  defaultFinish: string | null;
  createdAt: string;
  updatedAt?: string;
  rooms: QuotationRoom[];
}

export interface Company {
  id: number;
  name: string;
  gstNumber: string | null;
  phone: string;
  email: string | null;
  address: string;
  logoUrl: string | null;
  tagline: string | null;
}

export interface HouseType {
  id: number;
  name: string;
  description: string | null;
  isActive: boolean;
  sortOrder: number;
  roomTemplate?: HouseTypeRoomTemplate[];
}

export interface RoomType {
  id: number;
  name: string;
  icon: string | null;
  isActive: boolean;
  sortOrder: number;
}

export interface HouseTypeRoomTemplate {
  id: number;
  houseTypeId: number;
  roomTypeId: number;
  roomType?: RoomType;
  defaultCount: number;
  sortOrder: number;
}

export interface AdminUser {
  id: number;
  email: string;
  name: string | null;
  firstName?: string | null;
  lastName?: string | null;
  gstNumber?: string | null;
  contactNumber?: string | null;
  address?: string | null;
  role: AdminRole;
  isActive: boolean;
  assignedSalesId?: number | null;
  assignedSales?: AdminUser | null;
  discountAllocationPercent?: number;
  discountAllocationHistory?: Array<{
    allocatedPercent: number;
    previousPercent: number;
    changedBy: number;
    changedByName: string | null;
    changedAt: string;
  }>;
  totalQuotations?: number;
  accumulatedEarnings?: number;
  createdAt: string;
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: PaginationMeta;
}
