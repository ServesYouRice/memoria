/**
 * API Versioning Configuration
 *
 * API versioning strategy.
 *
 * This module provides version management for the Memoria API.
 * Following semantic versioning (semver) principles.
 *
 * @see docs/API_VERSIONING.md for detailed versioning policy
 */

/**
 * Current API version
 * Format: MAJOR.MINOR.PATCH
 * - MAJOR: Breaking changes
 * - MINOR: New features, backwards compatible
 * - PATCH: Bug fixes, backwards compatible
 */
export const API_VERSION = "1.0.0";

/**
 * API version prefix used in routes
 */
export const API_VERSION_PREFIX = "v1";

/**
 * Supported API versions
 * Older versions may be deprecated but still supported
 */
export const SUPPORTED_VERSIONS = ["v1"];

/**
 * Deprecated API versions
 * These will be removed in a future release
 * Format: { version: string, sunsetDate: string, migrationGuide: string }
 */
export const DEPRECATED_VERSIONS: Array<{
  version: string;
  sunsetDate: string;
  migrationGuide: string;
}> = [
  // Example when v2 is released:
  // {
  //   version: 'v1',
  //   sunsetDate: '2026-01-01',
  //   migrationGuide: 'https://docs.memoria.local/migration/v1-to-v2',
  // },
];

/**
 * Check if a version is deprecated
 */
export function isVersionDeprecated(version: string): boolean {
  return DEPRECATED_VERSIONS.some((v) => v.version === version);
}

/**
 * Get deprecation info for a version
 */
export function getDeprecationInfo(version: string) {
  return DEPRECATED_VERSIONS.find((v) => v.version === version);
}

/**
 * Check if a version is supported
 */
export function isVersionSupported(version: string): boolean {
  return SUPPORTED_VERSIONS.includes(version);
}

/**
 * Extract version from request path
 * Examples:
 *   /api/v1/canvases -> v1
 *   /api/v2/items -> v2
 */
export function extractVersionFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/api\/(v\d+)\//);
  return match?.[1] ?? null;
}

/**
 * API version headers to include in responses
 */
export function getVersionHeaders(requestPath: string): Record<string, string> {
  const version = extractVersionFromPath(requestPath);
  const headers: Record<string, string> = {
    "X-API-Version": API_VERSION,
    "X-API-Version-Prefix": API_VERSION_PREFIX,
  };

  // Add deprecation headers if applicable
  if (version && isVersionDeprecated(version)) {
    const deprecationInfo = getDeprecationInfo(version);
    if (deprecationInfo) {
      headers["X-API-Deprecated"] = "true";
      headers["X-API-Sunset"] = deprecationInfo.sunsetDate;
      headers["Link"] =
        `<${deprecationInfo.migrationGuide}>; rel="deprecation"`;
    }
  } else {
    headers["X-API-Deprecated"] = "false";
  }

  return headers;
}

/**
 * Validate API version in request
 * Returns error message if version is not supported, null if valid
 */
export function validateApiVersion(pathname: string): string | null {
  // Only validate paths that include a version
  if (!pathname.startsWith("/api/v")) {
    return null;
  }

  const version = extractVersionFromPath(pathname);

  if (!version) {
    return "API version not specified";
  }

  if (!isVersionSupported(version)) {
    return `API version ${version} is not supported. Supported versions: ${SUPPORTED_VERSIONS.join(", ")}`;
  }

  return null;
}
