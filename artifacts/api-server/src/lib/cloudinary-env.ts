// IMPORTANT: this module must be imported BEFORE the "cloudinary" package.
//
// The Cloudinary library reads CLOUDINARY_URL the moment it is loaded and throws if the
// value is malformed, which would stop the whole API from starting. A typo in one hosting
// setting must never do that, so here we (1) forgive the usual copy-and-paste slips and
// (2) remove the variable if it still cannot be used, so documents are simply switched off.

const EXPECTED = "cloudinary://<api key>:<api secret>@<cloud name>";

export function cleanCloudinaryUrl(raw: string | undefined): { value: string | null; changed: boolean } {
  if (raw === undefined || raw.trim() === "") return { value: null, changed: false };
  const unquote = (text: string) => text.trim().replace(/^(["'`])(.*)\1$/s, "$2").trim();
  let value = unquote(raw);
  // Pasted together with the variable name, e.g. "CLOUDINARY_URL=cloudinary://..."
  value = unquote(value.replace(/^CLOUDINARY_URL\s*=\s*/i, ""));
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "cloudinary:" || !parsed.username || !parsed.password || !parsed.hostname) return { value: null, changed: true };
  } catch {
    return { value: null, changed: true };
  }
  return { value, changed: value !== raw };
}

const raw = process.env.CLOUDINARY_URL;
const { value, changed } = cleanCloudinaryUrl(raw);
if (raw !== undefined && raw.trim() !== "") {
  if (value === null) {
    delete process.env.CLOUDINARY_URL;
    console.error(`[storage] CLOUDINARY_URL is not in the expected form (${EXPECTED}), so Cloudinary is switched off and document uploads are disabled. Re-enter the value in your host's environment settings.`);
  } else if (changed) {
    process.env.CLOUDINARY_URL = value;
    console.error('[storage] CLOUDINARY_URL contained extra characters (quotes, spaces or a "CLOUDINARY_URL=" prefix). They were ignored, but please correct the saved value.');
  }
}
