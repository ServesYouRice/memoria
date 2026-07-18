import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl =
    process.env.AUTH_URL || process.env.NEXTAUTH_URL || "http://localhost:3000";
  return [
    "/",
    "/help",
    "/privacy",
    "/status",
    "/terms",
    "/auth/login",
    "/auth/register",
  ].map((path) => ({
    url: new URL(path, baseUrl).toString(),
    lastModified: new Date(),
  }));
}
