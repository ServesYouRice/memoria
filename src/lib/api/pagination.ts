import { z } from "zod";
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from "@/lib/constants";

function parseBoundedInteger(
  value: string | null,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  if (value === null || value === "") return fallback;
  return z.coerce.number().int().min(minimum).max(maximum).parse(value);
}

export function parsePagination(
  searchParams: URLSearchParams,
  options: { defaultLimit?: number; maxLimit?: number } = {},
) {
  return {
    limit: parseBoundedInteger(
      searchParams.get("limit"),
      options.defaultLimit ?? DEFAULT_PAGE_LIMIT,
      1,
      options.maxLimit ?? MAX_PAGE_LIMIT,
    ),
    offset: parseBoundedInteger(searchParams.get("offset"), 0, 0, 1_000_000),
  };
}
