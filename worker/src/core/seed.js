// Seed data: default playbook tasks and budget categories (moved verbatim
// from index.js, #3).

import { now, uuid } from '../lib/http.js';
import { getSetting, setSetting } from './db.js';

export const SEED_TASKS = [
  { stage: 'initial_planning', title: 'Agree your top three wedding priorities', guidance: 'Sit down together and each pick what matters most (guests? food? photography?). Record these in Setup - they drive every decision.', owner: 'together', weeks: 52 },
  { stage: 'initial_planning', title: 'Agree non-negotiables and guest style', guidance: 'Decide the tone (formal/informal, religious/civil), whether children are invited, and any must-have elements. Record in Setup.', owner: 'together', weeks: 52 },
  { stage: 'initial_planning', title: 'Set a realistic budget ceiling and contingency', guidance: 'Agree the total budget you both feel comfortable with and a contingency level (typically 5-10%). Track everything in Budget.', owner: 'together', weeks: 52 },
  { stage: 'initial_planning', title: 'Agree guest target and draft day/evening list', guidance: 'Estimate how many day guests and evening guests you can afford and seat. Use the Guests tab to build the list.', owner: 'together', weeks: 52 },
  { stage: 'initial_planning', title: 'Open companion folders for contracts, quotes, receipts and inspiration', guidance: 'Create OneDrive folders and paste links into supplier records and decisions so nothing gets lost.', owner: 'together', weeks: 52 },
  { stage: 'venue_ceremony', title: 'Shortlist and visit ceremony venues', guidance: 'Use the Suppliers tab to compare. Ask about capacity, licensed ceremonies, cost, exclusivity, cancellation terms.', owner: 'together', weeks: 44 },
  { stage: 'venue_ceremony', title: 'Shortlist and visit reception venues', guidance: 'Compare capacity, catering options, timings, corkage, overnight rooms, and what happens if it rains.', owner: 'together', weeks: 44 },
  { stage: 'venue_ceremony', title: 'Book ceremony venue and confirm ceremony type', guidance: 'Confirm whether the ceremony is civil/religious and any authority requirements (registrar, vicar, venue licence).', owner: 'together', weeks: 40 },
  { stage: 'venue_ceremony', title: 'Book reception venue', guidance: 'Agree date, guest numbers, exclusivity and payment schedule. Keep the contract link in the supplier record.', owner: 'together', weeks: 40 },
  { stage: 'venue_ceremony', title: 'Confirm ceremony requirements with venue/authority', guidance: 'Check notice period, legal declarations, witnesses, music restrictions and any fees for the ceremony location.', owner: 'together', weeks: 36 },
  { stage: 'catering', title: 'Choose catering style and menu', guidance: 'Canapés, sit-down, buffet or street food? Collect quotes from venue catering or external suppliers.', owner: 'together', weeks: 32 },
  { stage: 'catering', title: 'Book caterer and agree final menu', guidance: 'Agree menu, dietary handling, corkage and service timings. Get it in writing.', owner: 'together', weeks: 30 },
  { stage: 'catering', title: 'Arrange drinks and bar', guidance: 'Decide welcome drink, wine with meal, toast choice and any bar tab. Budget separately or within catering.', owner: 'together', weeks: 28 },
  { stage: 'catering', title: 'Arrange wedding cake and dessert', guidance: 'Order cake or dessert table; confirm dietary needs and delivery time to the venue.', owner: 'together', weeks: 26 },
  { stage: 'outfits_rings', title: 'Choose engagement ring servicing', guidance: 'Have rings cleaned/checked in plenty of time; decide whether to add insurance.', owner: 'together', weeks: 40 },
  { stage: 'outfits_rings', title: 'Choose and order wedding rings', guidance: 'Allow time for sizing, engraving and any bespoke work. Book in for a fitting.', owner: 'together', weeks: 36 },
  { stage: 'outfits_rings', title: 'Choose bridal outfit and accessories', guidance: 'Allow multiple fittings; order early for alterations lead times.', owner: 'partner1', weeks: 34 },
  { stage: 'outfits_rings', title: 'Choose groom/partner outfit(s)', guidance: 'Consider hiring vs buying; coordinate colours with the scheme and each other.', owner: 'partner2', weeks: 34 },
  { stage: 'outfits_rings', title: 'Final fittings and outfit collection', guidance: 'Schedule final fittings 2-3 weeks before the wedding; collect outfits and check all accessories.', owner: 'partner1', weeks: 2 },
  { stage: 'stationery', title: 'Design and order save-the-dates', guidance: 'If sending save-the-dates, build your guest list and confirm addresses first.', owner: 'together', weeks: 36 },
  { stage: 'stationery', title: 'Design and order invitations and RSVP cards', guidance: 'Include the RSVP deadline and link to the form. Order spares for mistakes and keepsakes.', owner: 'together', weeks: 20 },
  { stage: 'stationery', title: 'Order thank-you cards, menus, place cards and signage', guidance: 'Agree a design system early so all stationery matches.', owner: 'together', weeks: 8 },
  { stage: 'entertainment', title: 'Book ceremony music', guidance: 'String quartet, organist or playlist? Confirm timings and any fees.', owner: 'partner2', weeks: 26 },
  { stage: 'entertainment', title: 'Book reception DJ or band', guidance: 'Confirm set times, first dance, sound limits and any PA requirements.', owner: 'partner2', weeks: 26 },
  { stage: 'entertainment', title: 'Plan first dance and other musical moments', guidance: 'Choose songs, book a dance lesson if wanted, and brief the DJ/band.', owner: 'together', weeks: 10 },
  { stage: 'flowers_decor', title: 'Choose and book florist', guidance: 'Bridal bouquet, buttonholes, ceremony and table flowers. Share colour scheme and budget.', owner: 'partner1', weeks: 28 },
  { stage: 'flowers_decor', title: 'Agree décor theme and styling', guidance: 'Colours, signage, table styling, lighting, props. Book stylist if needed.', owner: 'together', weeks: 24 },
  { stage: 'flowers_decor', title: 'Order décor items and confirm delivery/setup', guidance: 'Confirm what the venue provides and arrange collection of hired items after the wedding.', owner: 'together', weeks: 4 },
  { stage: 'photography_video', title: 'Book photographer', guidance: 'Review portfolios, agree coverage hours, edited photo count and delivery timeline.', owner: 'together', weeks: 36 },
  { stage: 'photography_video', title: 'Book videographer (optional) or agree film style', guidance: 'Decide full film vs highlights; agree raw footage ownership.', owner: 'together', weeks: 30 },
  { stage: 'photography_video', title: 'Send shot list and confirm photographer timings', guidance: 'Share must-have photos (family groups) and the run sheet so they know key moments.', owner: 'together', weeks: 4 },
  { stage: 'transport_accommodation', title: 'Arrange wedding transport', guidance: 'Guest shuttle, wedding car, or both? Confirm pick-up points and times in the run sheet.', owner: 'partner2', weeks: 20 },
  { stage: 'transport_accommodation', title: 'Block-book accommodation for guests', guidance: 'Agree room rates and how guests book. Record who needs a room in the Guests tab.', owner: 'together', weeks: 20 },
  { stage: 'transport_accommodation', title: 'Book your own honeymoon', guidance: 'Book flights, hotels and transfers in the Other Events & Honeymoon tab; link costs to the main budget.', owner: 'together', weeks: 28 },
  { stage: 'final_confirmations', title: 'Send invitations and manage RSVPs', guidance: 'Use the forms export and RSVP Inbox tab to import and review responses; update the guest list.', owner: 'together', weeks: 18 },
  { stage: 'final_confirmations', title: 'Finalise day menu and dietary requirements', guidance: 'Consolidate dietary needs from RSVPs and send final numbers to the caterer.', owner: 'partner1', weeks: 2 },
  { stage: 'final_confirmations', title: 'Final guest numbers to venue and caterer', guidance: 'Confirm final day/evening numbers and any layout changes due to numbers.', owner: 'together', weeks: 2 },
  { stage: 'final_confirmations', title: 'Confirm all suppliers and final timings', guidance: 'Call each supplier with the run sheet, arrival/setup times and your contact numbers.', owner: 'together', weeks: 1 },
  { stage: 'final_confirmations', title: 'Rehearsal and venue walkthrough', guidance: 'Confirm ceremony order, readings, vows and who hands over the rings and officiates.', owner: 'together', weeks: 1 },
  { stage: 'final_confirmations', title: 'Check marriage notice/legal paperwork', guidance: 'Ensure names, witnesses and documents are correct for the registrar.', owner: 'together', weeks: 2 },
  { stage: 'post_wedding', title: 'Return hired outfits, décor and equipment', guidance: 'Check return deadlines on hire contracts to avoid late fees.', owner: 'partner2', weeks: 0 },
  { stage: 'post_wedding', title: 'Send thank-you notes and track gifts', guidance: 'Use the gift tracking in the Guests tab; note when notes are sent.', owner: 'partner1', weeks: 0 },
  { stage: 'post_wedding', title: 'Settle final invoices and reconcile budget', guidance: 'Pay final balances, log refunds, and reconcile the Budget tab against your bank statements.', owner: 'together', weeks: 0 },
  { stage: 'post_wedding', title: 'Share photos with guests and suppliers', guidance: 'Share the gallery link, thank suppliers (and reviews where deserved).', owner: 'together', weeks: 0 },
  { stage: 'post_wedding', title: 'Weekly review routine', guidance: 'Every week: review the Dashboard, reconcile spending, process new RSVPs and agree each person up to three next actions.', owner: 'together', weeks: 0 },
  { stage: 'post_wedding', title: 'Update this system to a keepsake/archive', guidance: 'After the honeymoon, mark completed tasks done, export the full archive and store it with your wedding box.', owner: 'together', weeks: 0 },
];

export const SEED_CATEGORIES = [
  { name: 'Venue & catering', allowance: 0 },
  { name: 'Photography & video', allowance: 0 },
  { name: 'Attire & rings', allowance: 0 },
  { name: 'Flowers & décor', allowance: 0 },
  { name: 'Entertainment & music', allowance: 0 },
  { name: 'Stationery', allowance: 0 },
  { name: 'Transport & accommodation', allowance: 0 },
  { name: 'Other events & honeymoon', allowance: 0 },
  { name: 'Contingency & sundries', allowance: 0 },
];

export async function seedIfEmpty(env) {
  // Race-safe + idempotent: on the very first authenticated request several
  // parallel calls can hit this at once. A plain count-then-insert would
  // double-seed (observed live: 46 tasks × 5). Instead every insert carries a
  // WHERE NOT EXISTS guard (atomic per statement) and a settings flag skips
  // the work once it has completed.
  const seeded = await getSetting(env, 'seed_tasks_done');
  if (seeded === '1') return;

  const stmts = SEED_TASKS.map((t, i) =>
    env.DB.prepare(
      `INSERT INTO tasks (id, stage, order_index, title, description, guidance, owner, status, suggested_timing_weeks_before, created_at, updated_at)
       SELECT ?, ?, ?, ?, '', ?, ?, 'not_started', ?, ?, ?
       WHERE NOT EXISTS (SELECT 1 FROM tasks WHERE title = ?)`
    ).bind(uuid(), t.stage, i, t.title, t.guidance, t.owner, t.weeks, now(), now(), t.title)
  );
  if (stmts.length) await env.DB.batch(stmts);

  const catStmts = SEED_CATEGORIES.map((c, i) =>
    env.DB.prepare(
      `INSERT INTO budget_categories (id, name, order_index, allowance_pence, notes, created_at, updated_at)
       SELECT ?, ?, ?, ?, '', ?, ?
       WHERE NOT EXISTS (SELECT 1 FROM budget_categories WHERE name = ?)`
    ).bind(uuid(), c.name, i, c.allowance, now(), now(), c.name)
  );
  if (catStmts.length) await env.DB.batch(catStmts);

  await setSetting(env, 'seed_tasks_done', '1');
}
