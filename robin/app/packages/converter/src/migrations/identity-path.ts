/**
 * Normalize and validate a vault-relative page identity path before it is
 * compared with or written into robin:path metadata.
 */
export function normalizeIdentityPath(value: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+/g, "/").trim();
  if (
    !normalized ||
    normalized.includes("\0") ||
    normalized.startsWith("/") ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    throw new Error(`Invalid vault-relative identity path: ${value}`);
  }
  return normalized;
}
