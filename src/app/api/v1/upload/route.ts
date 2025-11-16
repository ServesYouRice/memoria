/**
 * Image Upload API
 *
 * Handles file uploads for canvas images with security measures:
 * - File type validation (images only)
 * - File size limits
 * - Sanitized filenames
 * - Storage in public/uploads directory
 */

import { NextRequest, NextResponse } from 'next/server';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';

// Maximum file size: 5MB
const MAX_FILE_SIZE = 5 * 1024 * 1024;

// Allowed image MIME types
const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
];

// Allowed file extensions
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'];

/**
 * Sanitize filename to prevent path traversal attacks
 */
function sanitizeFilename(filename: string): string {
  // Remove any directory path components
  const baseName = filename.replace(/^.*[\\\/]/, '');
  // Remove any potentially dangerous characters
  return baseName.replace(/[^a-zA-Z0-9._-]/g, '_');
}

/**
 * Generate a unique filename with timestamp and random string
 */
function generateUniqueFilename(originalFilename: string): string {
  const sanitized = sanitizeFilename(originalFilename);
  const extension = sanitized.substring(sanitized.lastIndexOf('.'));
  const nameWithoutExt = sanitized.substring(0, sanitized.lastIndexOf('.'));
  const timestamp = Date.now();
  const random = randomBytes(8).toString('hex');
  return `${nameWithoutExt}-${timestamp}-${random}${extension}`;
}

/**
 * Validate file extension
 */
function hasValidExtension(filename: string): boolean {
  const ext = filename.substring(filename.lastIndexOf('.')).toLowerCase();
  return ALLOWED_EXTENSIONS.includes(ext);
}

export async function POST(request: NextRequest) {
  try {
    // Check authentication
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse the form data
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // Validate file type
    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: `Invalid file type. Allowed types: ${ALLOWED_MIME_TYPES.join(', ')}` },
        { status: 400 }
      );
    }

    // Validate file extension
    if (!hasValidExtension(file.name)) {
      return NextResponse.json(
        { error: `Invalid file extension. Allowed extensions: ${ALLOWED_EXTENSIONS.join(', ')}` },
        { status: 400 }
      );
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File size exceeds maximum allowed size of ${MAX_FILE_SIZE / 1024 / 1024}MB` },
        { status: 400 }
      );
    }

    // Generate unique filename
    const uniqueFilename = generateUniqueFilename(file.name);

    // Convert file to buffer
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Define the upload path
    const uploadDir = join(process.cwd(), 'public', 'uploads');
    const filePath = join(uploadDir, uniqueFilename);

    // Write file to disk
    await writeFile(filePath, buffer);

    // Return the public URL
    const publicUrl = `/uploads/${uniqueFilename}`;

    return NextResponse.json({
      url: publicUrl,
      filename: file.name,
      size: file.size,
      type: file.type,
    });
  } catch (error) {
    console.error('Upload error:', error);
    return NextResponse.json(
      { error: 'Failed to upload file' },
      { status: 500 }
    );
  }
}
