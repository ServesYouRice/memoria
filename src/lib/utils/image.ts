/**
 * Image Utilities
 *
 * Helpers for image processing, resizing, and validation.
 *
 * @module lib/utils/image
 */

/**
 * Allowed image MIME types
 */
export const ALLOWED_IMAGE_TYPES = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/svg+xml',
] as const;

export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];

/**
 * Max file sizes
 */
export const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB
export const MAX_AVATAR_SIZE = 2 * 1024 * 1024; // 2MB

/**
 * Check if file is valid image
 */
export function isValidImage(file: File): boolean {
    return ALLOWED_IMAGE_TYPES.includes(file.type as AllowedImageType);
}

/**
 * Check if file is within size limit
 */
export function isWithinSizeLimit(file: File, maxSize = MAX_IMAGE_SIZE): boolean {
    return file.size <= maxSize;
}

/**
 * Validate image file
 */
export function validateImage(
    file: File,
    maxSize = MAX_IMAGE_SIZE
): { valid: boolean; error?: string } {
    if (!isValidImage(file)) {
        return { valid: false, error: `Invalid image type. Allowed: ${ALLOWED_IMAGE_TYPES.join(', ')}` };
    }
    if (!isWithinSizeLimit(file, maxSize)) {
        return { valid: false, error: `Image too large. Max size: ${formatBytes(maxSize)}` };
    }
    return { valid: true };
}

/**
 * Format bytes to human readable
 */
function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

/**
 * Get image dimensions
 */
export function getImageDimensions(file: File): Promise<{ width: number; height: number }> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            resolve({ width: img.naturalWidth, height: img.naturalHeight });
            URL.revokeObjectURL(img.src);
        };
        img.onerror = () => {
            reject(new Error('Failed to load image'));
            URL.revokeObjectURL(img.src);
        };
        img.src = URL.createObjectURL(file);
    });
}

/**
 * Resize image on client side
 */
export async function resizeImage(
    file: File,
    maxWidth: number,
    maxHeight: number,
    quality = 0.8
): Promise<Blob> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            let { width, height } = img;

            // Calculate new dimensions
            if (width > maxWidth || height > maxHeight) {
                const ratio = Math.min(maxWidth / width, maxHeight / height);
                width = Math.round(width * ratio);
                height = Math.round(height * ratio);
            }

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;

            const ctx = canvas.getContext('2d');
            if (!ctx) {
                reject(new Error('Failed to get canvas context'));
                return;
            }

            ctx.drawImage(img, 0, 0, width, height);

            canvas.toBlob(
                (blob) => {
                    if (blob) {
                        resolve(blob);
                    } else {
                        reject(new Error('Failed to create blob'));
                    }
                },
                'image/jpeg',
                quality
            );

            URL.revokeObjectURL(img.src);
        };

        img.onerror = () => {
            reject(new Error('Failed to load image'));
            URL.revokeObjectURL(img.src);
        };

        img.src = URL.createObjectURL(file);
    });
}

/**
 * Convert file to data URL
 */
export function fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
    });
}

/**
 * Convert data URL to blob
 */
export function dataUrlToBlob(dataUrl: string): Blob {
    const parts = dataUrl.split(',');
    const header = parts[0] || '';
    const data = parts[1];

    if (!data) {
        throw new Error('Invalid data URL format - missing data');
    }

    const mimeMatch = header.match(/:(.*?);/);
    const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
    const binary = atob(data);
    const array = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        array[i] = binary.charCodeAt(i);
    }
    return new Blob([array], { type: mime });
}
