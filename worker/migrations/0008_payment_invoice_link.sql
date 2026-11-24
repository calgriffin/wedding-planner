-- Payment invoice links (additive only).
--
-- Lets the couple attach the actual invoice to a payment without leaving the
-- planner — most invoices live in OneDrive / SharePoint, which hands out very
-- long share URLs, so the label is stored separately from the link for a
-- readable payments table.
--
-- Pure addition: two new TEXT columns with empty defaults. No existing row is
-- touched and no existing behaviour changes.
ALTER TABLE payments ADD COLUMN invoice_url TEXT DEFAULT '';
ALTER TABLE payments ADD COLUMN invoice_label TEXT DEFAULT '';
