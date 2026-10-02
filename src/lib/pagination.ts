import { PaginationMeta, PaginatedResponse } from "@/types";

export interface PaginationParams {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
}

export interface PaginationOptions {
  defaultPageSize?: number;
  maxPageSize?: number;
}

/**
 * Parses and sanitizes pagination parameters from URLSearchParams.
 * Enforces safe boundaries to prevent database overload (DoS/excessive limits).
 */
export function parsePaginationParams(
  searchParams: URLSearchParams,
  options?: PaginationOptions
): PaginationParams {
  const defaultPageSize = options?.defaultPageSize ?? 10;
  const maxPageSize = options?.maxPageSize ?? 100;

  const rawPage = parseInt(searchParams.get("page") || "1", 10);
  const rawPageSize = parseInt(
    searchParams.get("pageSize") || searchParams.get("limit") || String(defaultPageSize),
    10
  );

  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  const pageSize =
    Number.isFinite(rawPageSize) && rawPageSize > 0
      ? Math.min(rawPageSize, maxPageSize)
      : defaultPageSize;

  const skip = (page - 1) * pageSize;
  const take = pageSize;

  return {
    page,
    pageSize,
    skip,
    take,
  };
}

/**
 * Calculates pagination metadata from total count and current pagination parameters.
 */
export function createPaginationMeta(
  total: number,
  params: { page: number; pageSize: number }
): PaginationMeta {
  const validTotal = Math.max(0, total);
  const totalPages = Math.max(1, Math.ceil(validTotal / params.pageSize));
  const page = Math.min(params.page, totalPages);

  return {
    page,
    pageSize: params.pageSize,
    total: validTotal,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
  };
}

/**
 * Creates a standardized PaginatedResponse structure.
 */
export function createPaginatedResponse<T>(
  data: T[],
  total: number,
  params: { page: number; pageSize: number }
): PaginatedResponse<T> {
  return {
    data,
    pagination: createPaginationMeta(total, params),
  };
}
