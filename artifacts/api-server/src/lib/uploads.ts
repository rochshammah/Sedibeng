// Validation for sensitive uploads. The declared type must match the file's
// actual leading bytes, so renamed executables, SVG/HTML and scripts are rejected.
export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;

export const ALLOWED_DOCUMENT_TYPES = {
  "application/pdf": { extension: "pdf", magic: [0x25, 0x50, 0x44, 0x46, 0x2d] },
  "image/jpeg": { extension: "jpg", magic: [0xff, 0xd8, 0xff] },
  "image/png": { extension: "png", magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
} as const;

export type AllowedContentType = keyof typeof ALLOWED_DOCUMENT_TYPES;

export function isAllowedContentType(value: string | undefined): value is AllowedContentType {
  return !!value && value in ALLOWED_DOCUMENT_TYPES;
}

export function matchesMagicBytes(buffer: Buffer, contentType: AllowedContentType) {
  const { magic } = ALLOWED_DOCUMENT_TYPES[contentType];
  return buffer.length >= magic.length && magic.every((byte, index) => buffer[index] === byte);
}

/** A display-only name: no paths, no control characters, bounded length. */
export function sanitizeFilename(raw: string | undefined) {
  const base = (raw ?? "document").split(/[\\/]/).pop() ?? "document";
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, "").replace(/[^\w.\- ()]/g, "_").trim().slice(0, 80);
  return cleaned || "document";
}
