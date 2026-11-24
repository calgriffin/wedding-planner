/**
 * Core type definitions for the Wedding Planner
 * Matches the Excel workbook structure specified in the requirements
 */

// ==================== SETUP ====================
export interface WeddingSetup {
  id: string;
  partner1_name: string;
  partner2_name: string;
  wedding_date: string | null; // ISO date string
  ceremony_venue: string;
  reception_venue: string;
  budget_ceiling: number; // in pence (GBP)
  contingency_percent: number; // e.g., 10 for 10%
  contingency_amount: number; // calculated in pence
  guest_target: number | null;
  priority_1: string;
  priority_2: string;
  priority_3: string;
  non_negotiable_1: string;
  non_negotiable_2: string;
  non_negotiable_3: string;
  created_at: string;
  updated_at: string;
}

// ==================== TASKS & PLAYBOOK ====================
export type TaskStage =
  | 'initial_planning'
  | 'venue_ceremony'
  | 'catering'
  | 'outfits_rings'
  | 'stationery'
  | 'entertainment'
  | 'flowers_decor'
  | 'photography_video'
  | 'transport_accommodation'
  | 'final_confirmations'
  | 'post_wedding';

export type TaskOwner = 'partner1' | 'partner2' | 'together';
export type TaskStatus = 'not_started' | 'in_progress' | 'waiting' | 'done' | 'not_applicable';

export interface Task {
  id: string;
  stage: TaskStage;
  order_index: number;
  title: string;
  description: string;
  guidance: string; // Practical guidance from playbook
  owner: TaskOwner;
  status: TaskStatus;
  suggested_timing_weeks_before: number | null; // Relative to wedding date
  suggested_deadline: string | null; // Calculated ISO date
  agreed_deadline: string | null; // Manual override ISO date
  effective_deadline: string | null; // agreed_deadline || suggested_deadline
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export const TASK_STAGES: { value: TaskStage; label: string; order: number }[] = [
  { value: 'initial_planning', label: 'Initial Planning', order: 1 },
  { value: 'venue_ceremony', label: 'Venue & Ceremony', order: 2 },
  { value: 'catering', label: 'Catering', order: 3 },
  { value: 'outfits_rings', label: 'Outfits & Rings', order: 4 },
  { value: 'stationery', label: 'Stationery', order: 5 },
  { value: 'entertainment', label: 'Entertainment', order: 6 },
  { value: 'flowers_decor', label: 'Flowers & Décor', order: 7 },
  { value: 'photography_video', label: 'Photography & Video', order: 8 },
  { value: 'transport_accommodation', label: 'Transport & Accommodation', order: 9 },
  { value: 'final_confirmations', label: 'Final Confirmations', order: 10 },
  { value: 'post_wedding', label: 'Post-Wedding Admin', order: 11 },
];

// ==================== BUDGET ====================
export interface BudgetCategory {
  id: string;
  name: string;
  order_index: number;
  allowance_pence: number; // Budgeted amount
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface BudgetItem {
  id: string;
  category_id: string;
  name: string;
  supplier_id: string | null; // Link to supplier
  estimate_pence: number | null;
  agreed_price_pence: number | null; // When quoted/agreed
  forecast_pence: number; // Calculated: agreed_price || estimate || 0
  actual_pence: number; // Sum of payments
  remaining_pence: number; // forecast - actual
  is_priced: boolean; // Has estimate or agreed price
  notes: string;
  order_index: number;
  created_at: string;
  updated_at: string;
}

// ==================== PAYMENTS ====================
export type PaymentType = 'deposit' | 'instalment' | 'final' | 'refund';

export interface Payment {
  id: string;
  budget_item_id: string;
  type: PaymentType;
  due_date: string | null; // ISO date
  amount_pence: number;
  paid_date: string | null; // ISO date when actually paid
  status: 'pending' | 'paid' | 'overdue' | 'refunded';
  reference: string;
  notes: string;
  invoice_url?: string;
  invoice_label?: string;
  family_visible?: number; // 0 = hidden from the family portal
  created_at: string;
  updated_at: string;
}

// ==================== GUESTS ====================
export type GuestStatus = 'potential' | 'invited' | 'confirmed' | 'declined' | 'evening_only';
export type AttendanceType = 'day' | 'evening' | 'both' | 'none';

export interface Guest {
  id: string;
  household_id: string;
  is_primary: boolean; // Household head
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  invitation_code: string; // Unique code for RSVP
  status: GuestStatus;
  attendance_type: AttendanceType;
  dietary_needs: string;
  accessibility_requests: string;
  accommodation_needed: boolean;
  accommodation_booked: boolean;
  accommodation_details: string;
  gift_received: boolean;
  gift_description: string;
  thank_you_sent: boolean;
  thank_you_date: string | null;
  plus_one_of: string | null; // Guest ID if this is a plus-one
  plus_one_allowed: boolean; // Offered a plus-one to add on their RSVP
  plus_one_response: string; // '' | 'accepted' | 'declined'
  plus_one_pending?: boolean; // Offered, not answered: counted in the numbers
  plus_one_name?: string; // Name of the linked plus-one guest, if any
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface Household {
  id: string;
  name: string; // e.g., "Smith Family"
  address_line1: string;
  address_line2: string;
  city: string;
  postcode: string;
  country: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

// ==================== SUPPLIERS & VENUES ====================
export type SupplierCategory = 'venue_ceremony' | 'venue_reception' | 'catering' | 'photography' | 'videography' | 'flowers' | 'music' | 'transport' | 'accommodation' | 'cake' | 'stationery' | 'attire' | 'rings' | 'other';

export interface Supplier {
  id: string;
  category: SupplierCategory;
  name: string;
  contact_name: string;
  email: string;
  phone: string;
  website: string;
  address: string;
  quote_pence: number | null;
  inclusions: string; // What's included in the quote
  capacity: number | null;
  availability_confirmed: boolean;
  booking_status: 'researching' | 'shortlisted' | 'contacted' | 'quoted' | 'booked' | 'declined';
  contract_link: string; // URL to contract in OneDrive
  questions_to_ask: string; // Pre-booking questions
  notes: string;
  created_at: string;
  updated_at: string;
}

// ==================== DECISIONS & IDEAS ====================
export type DecisionCategory = 'ceremony' | 'clothing' | 'decor' | 'food' | 'music' | 'photography' | 'other';

export interface Decision {
  id: string;
  category: DecisionCategory;
  title: string;
  description: string;
  options: string; // JSON array of options
  chosen_option: string | null;
  inspiration_links: string; // JSON array of URLs
  decision_owner: TaskOwner;
  deadline: string | null; // ISO date
  decided_at: string | null;
  status: 'open' | 'decided' | 'deferred';
  notes: string;
  created_at: string;
  updated_at: string;
}

// ==================== SEATING & LOGISTICS ====================
export interface Table {
  id: string;
  name: string;
  capacity: number;
  shape: 'round' | 'rectangular' | 'square';
  location: string; // e.g., "Main hall - left side"
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface SeatingAssignment {
  id: string;
  table_id: string;
  guest_id: string;
  seat_number: number | null;
  created_at: string;
  updated_at: string;
}

export interface LogisticsItem {
  id: string;
  type: 'transport' | 'accommodation' | 'equipment' | 'other';
  name: string;
  description: string;
  supplier_id: string | null;
  cost_pence: number | null;
  confirmed: boolean;
  details: string; // JSON for flexible fields
  created_at: string;
  updated_at: string;
}

// ==================== WEDDING DAY ====================
export interface RunSheetItem {
  id: string;
  time: string; // HH:MM format
  end_time: string | null; // HH:MM format
  title: string;
  description: string;
  location: string;
  responsible_person: TaskOwner | 'supplier' | 'coordinator';
  supplier_id: string | null;
  is_critical: boolean; // Key milestone
  contingency_notes: string;
  order_index: number;
  created_at: string;
  updated_at: string;
}

export interface ContactSheetEntry {
  id: string;
  name: string;
  role: string;
  phone: string;
  email: string;
  notes: string;
  is_emergency: boolean;
  order_index: number;
}

export interface PackingListItem {
  id: string;
  category: 'ceremony' | 'reception' | 'personal' | 'emergency' | 'decor' | 'other';
  item: string;
  quantity: number;
  responsible_person: TaskOwner;
  packed: boolean;
  notes: string;
  order_index: number;
}

// ==================== OTHER EVENTS & HONEYMOON ====================
export interface OtherEvent {
  id: string;
  title: string;
  type: 'engagement_party' | 'hen_doe' | 'stag_doe' | 'rehearsal_dinner' | 'brunch' | 'honeymoon' | 'other';
  date: string | null; // ISO date
  venue: string;
  description: string;
  guest_count: number | null;
  budget_link_id: string | null; // Link to budget item instead of duplicating
  tasks: string; // JSON array of task descriptions
  status: 'planning' | 'booked' | 'completed' | 'cancelled' | 'not_applicable';
  notes: string;
  created_at: string;
  updated_at: string;
}

// ==================== RSVP INBOX ====================
export interface RSVPImport {
  id: string;
  invitation_code: string;
  guest_name: string; // As entered in form
  attendance: 'yes' | 'no' | 'evening_only';
  dietary_needs: string;
  accessibility_requests: string;
  travel_requests: string;
  submitted_at: string; // ISO datetime
  matched_guest_id: string | null;
  match_status: 'matched' | 'unmatched' | 'duplicate' | 'conflict' | 'pending_review';
  review_status: 'pending' | 'accepted' | 'rejected' | 'flagged';
  reviewed_at: string | null;
  reviewed_by: string | null;
  notes: string;
  created_at: string;
}

// ==================== MASTER TIMELINE ====================
export interface Appointment {
  id: string;
  title: string;
  date: string; // ISO date YYYY-MM-DD
  time: string | null; // HH:MM optional
  location: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

export type TimelineItemType =
  | 'task' | 'payment' | 'supplier' | 'appointment' | 'event' | 'decision' | 'rsvp';

export interface TimelineItem {
  id: string;
  type: TimelineItemType;
  date: string; // ISO date YYYY-MM-DD
  time: string | null;
  title: string;
  subtitle: string;
  status: string;
  amount_pence?: number | null;
  location?: string;
  notes?: string;
  overdue: boolean;
}

// ==================== EMAIL & REMINDERS ====================
export type EmailAudience = 'all' | 'unresponded' | 'confirmed' | 'declined' | 'household';

export interface EmailRecipient {
  email: string;
  name: string;
  household_id: string;
  household_name: string;
  status: 'pending' | 'confirmed' | 'declined';
  code: string;
}

export interface EmailCampaign {
  id: string;
  kind: 'couple_reminder' | 'guest_campaign' | 'rsvp_reminder';
  subject: string;
  audience: EmailAudience | 'self';
  recipient_count: number;
  status: 'sent' | 'partial' | 'failed';
  dry_run: number;
  error: string;
  sent_at: string | null;
  created_at: string;
}

export interface EmailLogEntry {
  id: string;
  campaign_id: string;
  to_email: string;
  to_name: string;
  subject: string;
  status: 'sent' | 'failed';
  provider_id: string;
  error: string;
  sent_at: string;
}

// ==================== DASHBOARD / COMPUTED ====================
export interface DashboardStats {
  tasks: {
    total: number;
    completed: number;
    overdue: number;
    due_this_week: number;
    due_next_week: number;
  };
  budget: {
    ceiling_pence: number;
    contingency_pence: number;
    forecast_pence: number;
    actual_pence: number;
    remaining_pence: number;
    remaining_after_contingency_pence: number;
  };
  guests: {
    total_potential: number;
    total_invited: number;
    confirmed_day: number;
    confirmed_evening: number;
    declined: number;
    pending: number;
    dietary_count: number;
    accessibility_count: number;
  };
  payments: {
    overdue_count: number;
    overdue_total_pence: number;
    due_this_week_count: number;
    due_this_week_total_pence: number;
  };
  decisions: {
    open: number;
    decided: number;
    overdue: number;
  };
  rsvp: {
    last_import: string | null;
    pending_review: number;
    unmatched: number;
  };
}

// ==================== API RESPONSES ====================
export interface ApiResponse<T> {
  data: T | null;
  error: string | null;
  success: boolean;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

// ==================== FORM SCHEMAS (Zod) ====================
// These will be imported from a separate validation file
export type { };

// ==================== UTILITY TYPES ====================
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export type EntityId = string & { readonly __brand: unique symbol };
export function createEntityId(id: string): EntityId {
  return id as EntityId;
}