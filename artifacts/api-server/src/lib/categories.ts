// A category's "group" decides whether goods and a request are relevant to each other.
// The same rules are used by migration 0004 to group existing rows, so keep them in sync.
export type CategoryGroup =
  | "SHOES"
  | "UNIFORMS"
  | "BAGS"
  | "BOOKS_STATIONERY"
  | "LEARNING_MATERIALS"
  | "OTHER";

export function categoryGroupOf(category: string): CategoryGroup {
  const text = category.toLowerCase();
  if (text.includes("shoe")) return "SHOES";
  if (text.includes("uniform")) return "UNIFORMS";
  if (text.includes("bag")) return "BAGS";
  if (/(stationery|exercise|textbook|book)/.test(text)) return "BOOKS_STATIONERY";
  if (/(learning|material)/.test(text)) return "LEARNING_MATERIALS";
  return "OTHER";
}

export const GOODS_CONDITIONS = ["NEW", "GOOD", "FAIR"] as const;
