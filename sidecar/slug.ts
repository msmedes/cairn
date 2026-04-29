export const UNTITLED_SLUG = "untitled";
const DEFAULT_MAX_LENGTH = 64;

export type SlugifyOptions = {
  maxLength?: number;
};

export function slugify(input: string, options: SlugifyOptions = {}): string {
  const maxLength = Math.max(1, options.maxLength ?? DEFAULT_MAX_LENGTH);
  const normalized = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

  const trimmed = normalized.slice(0, maxLength).replace(/-+$/g, "");
  return trimmed || UNTITLED_SLUG;
}

export function withDatePrefix(slug: string, date: Date = new Date()): string {
  const datePart = date.toISOString().slice(0, 10);
  return `${datePart}-${slugify(slug)}`;
}

export function disambiguate(
  slug: string,
  existingSlugs: Iterable<string>,
): string {
  const base = slugify(slug, { maxLength: 80 });
  const existing = new Set(existingSlugs);
  if (!existing.has(base)) return base;

  for (let index = 2; ; index += 1) {
    const candidate = `${base}-${index}`;
    if (!existing.has(candidate)) return candidate;
  }
}
