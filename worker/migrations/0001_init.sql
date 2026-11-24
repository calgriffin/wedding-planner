-- Wedding Planner - initial schema
-- All monetary values stored in pence (GBP Integer)
-- Timestamps stored as ISO-8601 strings (UTC)

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Single-row setup record
CREATE TABLE IF NOT EXISTS setup (
  id TEXT PRIMARY KEY,
  partner1_name TEXT DEFAULT '',
  partner2_name TEXT DEFAULT '',
  wedding_date TEXT,
  ceremony_venue TEXT DEFAULT '',
  reception_venue TEXT DEFAULT '',
  budget_ceiling INTEGER DEFAULT 0,
  contingency_percent INTEGER DEFAULT 10,
  guest_target INTEGER,
  priority_1 TEXT DEFAULT '',
  priority_2 TEXT DEFAULT '',
  priority_3 TEXT DEFAULT '',
  non_negotiable_1 TEXT DEFAULT '',
  non_negotiable_2 TEXT DEFAULT '',
  non_negotiable_3 TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  stage TEXT NOT NULL,
  order_index INTEGER DEFAULT 0,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  guidance TEXT DEFAULT '',
  owner TEXT DEFAULT 'together',
  status TEXT DEFAULT 'not_started',
  suggested_timing_weeks_before INTEGER,
  suggested_deadline TEXT,
  agreed_deadline TEXT,
  effective_deadline TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_tasks_stage ON tasks(stage);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

CREATE TABLE IF NOT EXISTS budget_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  order_index INTEGER DEFAULT 0,
  allowance_pence INTEGER DEFAULT 0,
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS budget_items (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES budget_categories(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  supplier_id TEXT,
  estimate_pence INTEGER,
  agreed_price_pence INTEGER,
  forecast_pence INTEGER DEFAULT 0,
  actual_pence INTEGER DEFAULT 0,
  notes TEXT DEFAULT '',
  order_index INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_budget_items_category ON budget_items(category_id);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  budget_item_id TEXT NOT NULL REFERENCES budget_items(id) ON DELETE CASCADE,
  type TEXT DEFAULT 'instalment',
  due_date TEXT,
  amount_pence INTEGER DEFAULT 0,
  paid_date TEXT,
  status TEXT DEFAULT 'pending',
  reference TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_payments_item ON payments(budget_item_id);

CREATE TABLE IF NOT EXISTS households (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  address_line1 TEXT DEFAULT '',
  address_line2 TEXT DEFAULT '',
  city TEXT DEFAULT '',
  postcode TEXT DEFAULT '',
  country TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS guests (
  id TEXT PRIMARY KEY,
  household_id TEXT REFERENCES households(id) ON DELETE SET NULL,
  is_primary INTEGER DEFAULT 0,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  invitation_code TEXT,
  status TEXT DEFAULT 'potential',
  attendance_type TEXT DEFAULT 'none',
  dietary_needs TEXT DEFAULT '',
  accessibility_requests TEXT DEFAULT '',
  accommodation_needed INTEGER DEFAULT 0,
  accommodation_booked INTEGER DEFAULT 0,
  accommodation_details TEXT DEFAULT '',
  gift_received INTEGER DEFAULT 0,
  gift_description TEXT DEFAULT '',
  thank_you_sent INTEGER DEFAULT 0,
  thank_you_date TEXT,
  plus_one_of TEXT,
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_guests_household ON guests(household_id);
CREATE INDEX IF NOT EXISTS idx_guests_status ON guests(status);
CREATE INDEX IF NOT EXISTS idx_guests_code ON guests(invitation_code);

CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY,
  category TEXT DEFAULT 'other',
  name TEXT NOT NULL,
  contact_name TEXT DEFAULT '',
  email TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  website TEXT DEFAULT '',
  address TEXT DEFAULT '',
  quote_pence INTEGER,
  inclusions TEXT DEFAULT '',
  capacity INTEGER,
  availability_confirmed INTEGER DEFAULT 0,
  booking_status TEXT DEFAULT 'researching',
  contract_link TEXT DEFAULT '',
  questions_to_ask TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS decisions (
  id TEXT PRIMARY KEY,
  category TEXT DEFAULT 'other',
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  options TEXT DEFAULT '[]',
  chosen_option TEXT,
  inspiration_links TEXT DEFAULT '[]',
  decision_owner TEXT DEFAULT 'together',
  deadline TEXT,
  decided_at TEXT,
  status TEXT DEFAULT 'open',
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS tables (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  capacity INTEGER DEFAULT 8,
  shape TEXT DEFAULT 'round',
  location TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS seating_assignments (
  id TEXT PRIMARY KEY,
  table_id TEXT NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
  guest_id TEXT NOT NULL UNIQUE REFERENCES guests(id) ON DELETE CASCADE,
  seat_number INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_seating_table ON seating_assignments(table_id);
CREATE INDEX IF NOT EXISTS idx_seating_guest ON seating_assignments(guest_id);

CREATE TABLE IF NOT EXISTS logistics (
  id TEXT PRIMARY KEY,
  type TEXT DEFAULT 'other',
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  supplier_id TEXT,
  cost_pence INTEGER,
  confirmed INTEGER DEFAULT 0,
  details TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS run_sheet (
  id TEXT PRIMARY KEY,
  time TEXT NOT NULL,
  end_time TEXT,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  location TEXT DEFAULT '',
  responsible_person TEXT DEFAULT 'coordinator',
  supplier_id TEXT,
  is_critical INTEGER DEFAULT 0,
  contingency_notes TEXT DEFAULT '',
  order_index INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  is_emergency INTEGER DEFAULT 0,
  order_index INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS packing_list (
  id TEXT PRIMARY KEY,
  category TEXT DEFAULT 'other',
  item TEXT NOT NULL,
  quantity INTEGER DEFAULT 1,
  responsible_person TEXT DEFAULT 'together',
  packed INTEGER DEFAULT 0,
  notes TEXT DEFAULT '',
  order_index INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  type TEXT DEFAULT 'other',
  date TEXT,
  venue TEXT DEFAULT '',
  description TEXT DEFAULT '',
  guest_count INTEGER,
  budget_link_id TEXT,
  tasks TEXT DEFAULT '[]',
  status TEXT DEFAULT 'planning',
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS rsvp_imports (
  id TEXT PRIMARY KEY,
  invitation_code TEXT NOT NULL,
  guest_name TEXT NOT NULL,
  attendance TEXT DEFAULT 'yes',
  dietary_needs TEXT DEFAULT '',
  accessibility_requests TEXT DEFAULT '',
  travel_requests TEXT DEFAULT '',
  submitted_at TEXT NOT NULL,
  matched_guest_id TEXT,
  match_status TEXT DEFAULT 'pending_review',
  review_status TEXT DEFAULT 'pending',
  reviewed_at TEXT,
  reviewed_by TEXT,
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_rsvp_code ON rsvp_imports(invitation_code);
CREATE INDEX IF NOT EXISTS idx_rsvp_review ON rsvp_imports(review_status);