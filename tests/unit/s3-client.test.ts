import { describe, expect, it } from "vitest";
import { createS3Client, isR2Endpoint } from "@/lib/uploads/s3-client.mjs";

const creds = { accessKeyId: "k", secretAccessKey: "s" };

describe("createS3Client", () => {
  it("uses region auto, virtual-host style and WHEN_REQUIRED checksums for R2", async () => {
    const endpoint = "https://abc123.r2.cloudflarestorage.com";
    expect(isR2Endpoint(endpoint)).toBe(true);
    const client = createS3Client({ region: "us-east-1", endpoint, ...creds });
    expect(await client.config.region()).toBe("auto");
    expect(client.config.forcePathStyle).toBe(false);
    expect(await client.config.requestChecksumCalculation()).toBe(
      "WHEN_REQUIRED",
    );
    expect(await client.config.responseChecksumValidation()).toBe(
      "WHEN_REQUIRED",
    );
  });

  it("keeps region, path-style and WHEN_REQUIRED checksums for SeaweedFS", async () => {
    const endpoint = "http://seaweedfs:8333";
    expect(isR2Endpoint(endpoint)).toBe(false);
    const client = createS3Client({ region: "us-east-1", endpoint, ...creds });
    expect(await client.config.region()).toBe("us-east-1");
    expect(client.config.forcePathStyle).toBe(true);
    expect(await client.config.requestChecksumCalculation()).toBe(
      "WHEN_REQUIRED",
    );
    expect(await client.config.responseChecksumValidation()).toBe(
      "WHEN_REQUIRED",
    );
  });

  it("does not treat invalid or missing endpoints as R2", () => {
    expect(isR2Endpoint(undefined)).toBe(false);
    expect(isR2Endpoint("not a url")).toBe(false);
  });
});
