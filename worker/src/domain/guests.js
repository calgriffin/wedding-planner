// Guest helpers shared across routes: plus-one placeholders (moved verbatim
// from index.js, #3).

// Plus-ones: the couple can offer a guest a plus-one without naming them
// (guests.plus_one_allowed). The guest adds the person on their RSVP, which
// creates a normal guest row linked by plus_one_of. Until the host answers,
// the offered place is "pending": it has no row of its own, but it still
// counts in the headcounts.
export async function pendingPlusOnes(env) {
  const r = await env.DB.prepare(
    `SELECT g.id, g.household_id, g.status FROM guests g
     WHERE g.plus_one_allowed = 1
       AND (g.status IS NULL OR g.status != 'declined')
       AND COALESCE(g.plus_one_response, '') = ''
       AND NOT EXISTS (SELECT 1 FROM guests p WHERE p.plus_one_of = g.id)`
  ).all();
  return r.results || [];
}

// The name a plus-one is listed under when the guest is bringing someone but
// has not said who yet.
export function plusOnePlaceholderName(host) {
  return { first_name: 'Guest', last_name: `of ${host.first_name} ${host.last_name}`.trim() };
}

export function isPlusOnePlaceholderName(guest, host) {
  const ph = plusOnePlaceholderName(host);
  return guest.first_name === ph.first_name && guest.last_name === ph.last_name;
}
