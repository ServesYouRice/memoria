import { readFile, unlink } from "fs/promises";
import { join, resolve, sep } from "path";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getCanvasAccess, requireCanvasAccess } from "@/lib/api/auth";
import { withApiHandler } from "@/lib/api/route-handler";
import { prisma } from "@/lib/db";
import { notFoundError, unauthorizedError } from "@/lib/errors";

interface RouteContext {
  params: Promise<{ assetId: string }>;
}

let s3Client: S3Client | null = null;

function getS3Client() {
  if (s3Client) return s3Client;
  const region = process.env.S3_REGION;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  if (!region || !accessKeyId || !secretAccessKey) {
    throw new Error("Private upload storage is not configured");
  }
  s3Client = new S3Client({
    region,
    endpoint: process.env.S3_ENDPOINT,
    forcePathStyle: Boolean(process.env.S3_ENDPOINT),
    credentials: { accessKeyId, secretAccessKey },
  });
  return s3Client;
}

function getLocalPath(storageKey: string) {
  const root = resolve(join(process.cwd(), ".data", "uploads"));
  const relativeKey = storageKey.replace(/^uploads[\\/]/, "");
  const target = resolve(join(root, relativeKey));
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
  if (!target.startsWith(prefix)) throw notFoundError("Upload");
  return target;
}

async function findAsset(assetId: string) {
  const asset = await prisma.uploadAsset.findUnique({
    where: { id: assetId },
    include: {
      canvas: { select: { isPublic: true } },
    },
  });
  if (!asset) throw notFoundError("Upload", assetId);
  return asset;
}

export const GET = withApiHandler(
  async (_request: NextRequest, { params }: RouteContext) => {
    const { assetId } = await params;
    const asset = await findAsset(assetId);

    if (!asset.canvas.isPublic) {
      const session = await auth();
      if (!session?.user?.id || !session.user.email) {
        throw unauthorizedError();
      }
      const access = await getCanvasAccess(
        asset.canvasId,
        session.user.id,
        session.user.email,
      );
      if (access === "NONE") throw notFoundError("Upload", assetId);
    }

    let bytes: Uint8Array;
    if (asset.storageMode === "s3") {
      const bucket = process.env.S3_BUCKET;
      if (!bucket) throw new Error("Private upload bucket is not configured");
      const object = await getS3Client().send(
        new GetObjectCommand({ Bucket: bucket, Key: asset.storageKey }),
      );
      if (!object.Body) throw notFoundError("Upload", assetId);
      bytes = await object.Body.transformToByteArray();
    } else {
      bytes = await readFile(getLocalPath(asset.storageKey));
    }

    const responseBytes = new Uint8Array(bytes.byteLength);
    responseBytes.set(bytes);
    return new NextResponse(responseBytes.buffer, {
      headers: {
        "content-type": asset.mimeType,
        "content-length": String(bytes.byteLength),
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(asset.filename)}`,
      },
    });
  },
);

export const DELETE = withApiHandler(
  async (_request: NextRequest, { params }: RouteContext) => {
    const session = await auth();
    if (!session?.user?.id || !session.user.email) throw unauthorizedError();
    const { assetId } = await params;
    const asset = await findAsset(assetId);
    await requireCanvasAccess(
      asset.canvasId,
      session.user.id,
      session.user.email,
      "OWNER",
    );

    if (asset.storageMode === "s3") {
      const bucket = process.env.S3_BUCKET;
      if (!bucket) throw new Error("Private upload bucket is not configured");
      await getS3Client().send(
        new DeleteObjectCommand({ Bucket: bucket, Key: asset.storageKey }),
      );
    } else {
      await unlink(getLocalPath(asset.storageKey)).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
        },
      );
    }

    await prisma.uploadAsset.delete({ where: { id: asset.id } });
    return NextResponse.json({ success: true });
  },
);
