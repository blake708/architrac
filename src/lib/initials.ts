/**
 * Up to two initials from a person's name, for avatars.
 * "Blake Middleton" → "BM", "Cher" → "CH", "Mary Ann de la Cruz" → "MC".
 */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[words.length - 1]![0]!).toUpperCase();
}
