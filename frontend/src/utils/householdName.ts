/**
 * A household name built from its guests' names:
 *   John Smith · John & Sam Smith · John Smith & Jane Doe ·
 *   John, Sam & Amy Smith · John & Sam Smith and Jane Doe
 * The primary guest comes first, then guests in the order they were added.
 * Plus-ones are left out (unless nobody else is named), as are blank names.
 */
interface NamedGuest {
  first_name?: string;
  last_name?: string;
  is_primary?: number | boolean;
  plus_one_of?: string | null;
  created_at?: string;
}

const andList = (parts: string[], last = ' & ') =>
  parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')}${last}${parts[parts.length - 1]}`;

export function householdNameFromGuests(guests: NamedGuest[]): string {
  const named = guests.filter((g) => (g.first_name || '').trim() || (g.last_name || '').trim());
  const invited = named.filter((g) => !g.plus_one_of);
  const people = (invited.length ? invited : named)
    .slice()
    .sort((a, b) => Number(!!b.is_primary) - Number(!!a.is_primary) || (a.created_at || '').localeCompare(b.created_at || ''));

  // Group by surname, keeping the order each surname first appears in.
  const groups: { surname: string; firsts: string[] }[] = [];
  for (const g of people) {
    const first = (g.first_name || '').trim();
    const surname = (g.last_name || '').trim();
    let group = groups.find((x) => x.surname.toLowerCase() === surname.toLowerCase());
    if (!group) groups.push((group = { surname, firsts: [] }));
    if (first) group.firsts.push(first);
  }
  const parts = groups.map((x) => [andList(x.firsts), x.surname].filter(Boolean).join(' '));
  // "John Smith & Jane Doe", but "John & Sam Smith and Jane Doe" so the
  // ampersands inside a family stay readable.
  const joiner = groups.some((x) => x.firsts.length > 1) ? ' and ' : ' & ';
  return andList(parts, joiner);
}
