export const AVATAR_MAX_BYTES = 204800; // 200 KB exact limit matching storage.buckets.file_size_limit
export const AVATAR_ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export function validateAvatarFile(file: { type: string; size: number }): {
  valid: boolean;
  error?: string;
} {
  if (!AVATAR_ALLOWED_MIME_TYPES.includes(file.type as any)) {
    return {
      valid: false,
      error: "Only JPEG, PNG, or WebP images are permitted.",
    };
  }
  // Allow source images up to 10 MB before client-side compression; reject corrupt/empty files
  if (file.size <= 0) {
    return { valid: false, error: "Selected file is empty." };
  }
  if (file.size > 10 * 1024 * 1024) {
    return { valid: false, error: "Source image must be 10 MB or smaller." };
  }
  return { valid: true };
}

export function computeScaledDimensions(
  width: number,
  height: number,
  maxDim: number
): { width: number; height: number } {
  if (width <= 0 || height <= 0 || maxDim <= 0) {
    return { width: 1, height: 1 };
  }
  if (width <= maxDim && height <= maxDim) {
    return { width: Math.round(width), height: Math.round(height) };
  }
  const scale = maxDim / Math.max(width, height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality?: number
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mimeType, quality);
  });
}

/**
 * Compresses an uploaded image in the browser to stay strictly <= 200 KB
 * before uploading to the private `avatars` Storage bucket.
 */
export async function compressAvatarImage(
  file: File,
  maxBytes: number = AVATAR_MAX_BYTES
): Promise<{ blob: Blob; mimeType: "image/webp" | "image/jpeg" | "image/png" }> {
  const check = validateAvatarFile(file);
  if (!check.valid) {
    throw new Error(check.error);
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Could not decode image file."));
      el.src = objectUrl;
    });

    const dimensionSteps = [512, 384, 256, 192, 128];
    const qualitySteps = [0.88, 0.72, 0.56, 0.42, 0.28];
    const targetMime: "image/webp" | "image/jpeg" =
      file.type === "image/png" ? "image/webp" : "image/jpeg";

    for (const maxDim of dimensionSteps) {
      const { width, height } = computeScaledDimensions(
        img.naturalWidth || img.width,
        img.naturalHeight || img.height,
        maxDim
      );
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        throw new Error("Canvas 2D context is unavailable.");
      }
      ctx.drawImage(img, 0, 0, width, height);

      for (const q of qualitySteps) {
        const blob = await canvasToBlob(canvas, targetMime, q);
        if (blob && blob.size <= maxBytes) {
          return {
            blob,
            mimeType: (blob.type as "image/webp" | "image/jpeg" | "image/png") || targetMime,
          };
        }
        // Also try JPEG fallback if browser didn't encode small WebP
        if (targetMime === "image/webp") {
          const jpegBlob = await canvasToBlob(canvas, "image/jpeg", q);
          if (jpegBlob && jpegBlob.size <= maxBytes) {
            return { blob: jpegBlob, mimeType: "image/jpeg" };
          }
        }
      }
    }

    throw new Error("Unable to compress avatar below 200 KB. Please choose a smaller image.");
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

