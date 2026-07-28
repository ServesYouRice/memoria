import { timingSafeEqual } from "crypto";

export function hasInternalOperationsAccess(request: Request): boolean {
  const configured = process.env.INTERNAL_OPERATIONS_TOKEN;
  const supplied = request.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "");
  if (!configured || !supplied) return false;
  const expected = Buffer.from(configured);
  const actual = Buffer.from(supplied);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
