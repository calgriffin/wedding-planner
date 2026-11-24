/**
 * Lean API client for the wedding planner worker.
 * All requests go to /api/* on the same origin.
 */

import type { Appointment, TimelineItem } from '../types';

export interface ApiError {
  error: string;
}

/**
 * Uploads a guest-site hero photo straight to the Worker (raw body, no JSON)
 * and returns the same-origin /media/ path to store as hero.photo_url.
 */
export async function uploadHeroPhoto(file: File): Promise<{ path: string }> {
  const res = await fetch('/api/guest-site/photo', {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
    credentials: 'same-origin',
  });
  const contentType = res.headers.get('content-type') || '';
  if (!res.ok) {
    let message = `Upload failed (${res.status})`;
    try {
      if (contentType.includes('application/json')) {
        const data = await res.json();
        message = data.error || message;
      }
    } catch { /* ignore */ }
    if (res.status === 401 || res.status === 403) {
      if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
        window.dispatchEvent(new CustomEvent('app:auth-failed', { detail: res.status }));
      }
    }
    throw new Error(message);
  }
  return res.json() as Promise<{ path: string }>;
}

export async function request<T = any>(
  path: string,
  options: { method?: string; body?: unknown; params?: Record<string, string | number | boolean | undefined>; headers?: Record<string, string> } = {}
): Promise<T> {
  const { method = 'GET', body, params, headers: extraHeaders } = options;
  let url = `/api${path}`;
  if (params) {
    const qs = Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&');
    if (qs) url += `?${qs}`;
  }
  const res = await fetch(url, {
    method,
    headers: body !== undefined || extraHeaders ? { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...extraHeaders } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const contentType = res.headers.get('content-type') || '';
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      if (contentType.includes('application/json')) {
        const data = await res.json();
        message = data.error || message;
      }
    } catch {
      /* ignore */
    }
    // 401/403 = session invalid, expired, or blocked. Whatever the page was
    // doing, bounce the app back to login instead of leaving the user on a
    // half-loaded page. The app context listens for this event.
    if (res.status === 401 || res.status === 403) {
      if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
        window.dispatchEvent(new CustomEvent('app:auth-failed', { detail: res.status }));
      }
    }
    const e = new Error(message) as Error & { status?: number };
    e.status = res.status;
    throw e;
  }
  if (contentType.includes('application/json')) {
    return res.json() as Promise<T>;
  }
  return res.text() as unknown as Promise<T>;
}

// Guest-site payload. Public GET /api/guest/site returns only the locked
// subset (locked: true, no content); the full shape arrives either via the
// couple's draft preview (?draft=1) or POST /api/guest/site/unlock.
export interface GuestSiteData {
  mode: string;
  couple: { name_one: string; name_two: string };
  wedding_date: string;
  ceremony_venue?: string;
  reception_venue?: string;
  rsvp_open: boolean;
  rsvp_opens_at: string;
  rsvp_closes_at: string;
  locked?: boolean;
  content?: any;
  meal_options?: string[];
  events?: Array<{ id: string; title: string; type: string; date: string; venue: string; description: string; start_time: string; end_time: string }>;
}

export interface McpConnection {
  id: string;
  name: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
}

// Family access list (GET/POST/DELETE /api/family/members). `sync` says
// whether the latest list has reached the Cloudflare Access policy.
export interface FamilyMember {
  id: string;
  email: string;
  label: string | null;
  created_at: string;
}

export interface FamilyAccess {
  members: FamilyMember[];
  couple_count: number;
  limit: number;
  portal_url: string;
  sync_configured: boolean;
  sync: { state: 'synced' | 'failed' | 'not_configured'; ok: boolean; at: string; count: number | null; message: string } | null;
}

// One row of the caterer dietary & allergy matrix (GET /api/rsvp/dietary-matrix).
export interface MatrixGuest {
  id: string;
  name: string;
  household_name: string;
  is_primary: boolean;
  status: string;
  attending: boolean;
  attendance_type: string;
  email: string;
  phone: string;
  meal: string;
  dietary: string;
  table_name: string;
  seat_number: number | null;
}

// API surface (paths match the worker routes)
export const api = {
  auth: {
    status: () =>
      request<{
        initialized: boolean;
        authenticated: boolean;
        temporary?: boolean;
        temporary_password?: string;
        provider?: 'password' | 'cloudflare-access';
        email?: string;
        logout_url?: string;
      }>('/auth/status'),
    init: (password: string, temporary = false) => request('/auth/init', { method: 'POST', body: { password, temporary } }),
    login: (password: string) => request('/auth/login', { method: 'POST', body: { password } }),
    logout: () => request<{ authenticated: false; logout_url?: string }>('/auth/logout', { method: 'POST' }),
    check: () => request('/auth/check'),
    changePassword: (current_password: string, new_password: string) =>
      request('/auth/change-password', { method: 'POST', body: { current_password, new_password } }),
  },
  setup: {
    get: () => request('/setup'),
    update: (data: Record<string, unknown>) => request('/setup', { method: 'PUT', body: data }),
  },
  // AI assistant (MCP) connection links. `token`/`url` only come back once, on create.
  mcp: {
    list: () => request<McpConnection[]>('/mcp/tokens'),
    create: (name: string) => request<McpConnection & { token: string; url: string }>('/mcp/tokens', { method: 'POST', body: { name } }),
    revoke: (id: string) => request(`/mcp/tokens/${id}`, { method: 'DELETE' }),
  },
  family: {
    access: () => request<FamilyAccess>('/family/members'),
    add: (email: string, label: string) => request<FamilyAccess>('/family/members', { method: 'POST', body: { email, label } }),
    remove: (id: string) => request<FamilyAccess>(`/family/members/${id}`, { method: 'DELETE' }),
    sync: () => request<FamilyAccess>('/family/sync', { method: 'POST' }),
  },
  dashboard: {
    stats: () => request('/dashboard/stats'),
    upcomingTasks: (limit = 10) => request('/dashboard/upcoming-tasks', { params: { limit } }),
    overduePayments: () => request('/dashboard/overdue-payments'),
    outstandingDecisions: () => request('/dashboard/outstanding-decisions'),
  },
  timeline: {
    list: () => request<{ items: TimelineItem[]; today: string }>('/timeline'),
  },
  appointments: {
    list: () => request<Appointment[]>('/appointments'),
    create: (data: Record<string, unknown>) => request('/appointments', { method: 'POST', body: data }),
    update: (id: string, data: Record<string, unknown>) => request(`/appointments/${id}`, { method: 'PUT', body: data }),
    remove: (id: string) => request(`/appointments/${id}`, { method: 'DELETE' }),
  },
  tasks: {
    list: (params?: { stage?: string; status?: string }) => request('/tasks', { params }),
    create: (data: Record<string, unknown>) => request('/tasks', { method: 'POST', body: data }),
    update: (id: string, data: Record<string, unknown>) => request(`/tasks/${id}`, { method: 'PUT', body: data }),
    remove: (id: string) => request(`/tasks/${id}`, { method: 'DELETE' }),
    reorder: (taskIds: string[]) => request('/tasks/reorder', { method: 'POST', body: { taskIds } }),
    recalculate: (weddingDate: string) => request('/tasks/recalculate', { method: 'POST', body: { weddingDate } }),
  },
  budget: {
    categories: () => request('/budget/categories'),
    createCategory: (data: Record<string, unknown>) => request('/budget/categories', { method: 'POST', body: data }),
    updateCategory: (id: string, data: Record<string, unknown>) => request(`/budget/categories/${id}`, { method: 'PUT', body: data }),
    deleteCategory: (id: string) => request(`/budget/categories/${id}`, { method: 'DELETE' }),
    items: (categoryId?: string) => request('/budget/items', { params: { category_id: categoryId } }),
    createItem: (data: Record<string, unknown>) => request('/budget/items', { method: 'POST', body: data }),
    updateItem: (id: string, data: Record<string, unknown>) => request(`/budget/items/${id}`, { method: 'PUT', body: data }),
    deleteItem: (id: string) => request(`/budget/items/${id}`, { method: 'DELETE' }),
    recalculate: () => request('/budget/items/recalculate', { method: 'POST' }),
  },
  payments: {
    list: (budgetItemId?: string) => request('/payments', { params: { budget_item_id: budgetItemId } }),
    create: (data: Record<string, unknown>) => request('/payments', { method: 'POST', body: data }),
    update: (id: string, data: Record<string, unknown>) => request(`/payments/${id}`, { method: 'PUT', body: data }),
    remove: (id: string) => request(`/payments/${id}`, { method: 'DELETE' }),
    markPaid: (id: string, paidDate: string) => request(`/payments/${id}/paid`, { method: 'PATCH', body: { paid_date: paidDate } }),
  },
  households: {
    list: () => request('/households'),
    create: (data: Record<string, unknown>) => request('/households', { method: 'POST', body: data }),
    update: (id: string, data: Record<string, unknown>) => request(`/households/${id}`, { method: 'PUT', body: data }),
    remove: (id: string) => request(`/households/${id}`, { method: 'DELETE' }),
  },
  guests: {
    list: (params?: { status?: string; household_id?: string }) => request('/guests', { params }),
    create: (data: Record<string, unknown>) => request('/guests', { method: 'POST', body: data }),
    update: (id: string, data: Record<string, unknown>) => request(`/guests/${id}`, { method: 'PUT', body: data }),
    remove: (id: string) => request(`/guests/${id}`, { method: 'DELETE' }),
    import: (guests: Record<string, unknown>[]) => request('/guests/import', { method: 'POST', body: { guests } }),
  },
  guestTags: {
    list: () => request<Array<{ id: string; name: string; color: string }>>('/guest-tags'),
    create: (data: { name: string; color?: string }) => request('/guest-tags', { method: 'POST', body: data }),
    update: (id: string, data: { name?: string; color?: string }) => request(`/guest-tags/${id}`, { method: 'PUT', body: data }),
    remove: (id: string) => request(`/guest-tags/${id}`, { method: 'DELETE' }),
    assignments: () => request<Array<{ guest_id: string; tag_id: string; name: string; color: string }>>('/guest-tags/assignments'),
    assign: (guestId: string, tagIds: string[]) => request(`/guests/${guestId}/tags`, { method: 'POST', body: { tag_ids: tagIds } }),
  },
  suppliers: {
    list: (category?: string) => request('/suppliers', { params: { category } }),
    create: (data: Record<string, unknown>) => request('/suppliers', { method: 'POST', body: data }),
    update: (id: string, data: Record<string, unknown>) => request(`/suppliers/${id}`, { method: 'PUT', body: data }),
    remove: (id: string) => request(`/suppliers/${id}`, { method: 'DELETE' }),
  },
  decisions: {
    list: (category?: string) => request('/decisions', { params: { category } }),
    create: (data: Record<string, unknown>) => request('/decisions', { method: 'POST', body: data }),
    update: (id: string, data: Record<string, unknown>) => request(`/decisions/${id}`, { method: 'PUT', body: data }),
    remove: (id: string) => request(`/decisions/${id}`, { method: 'DELETE' }),
  },
  seating: {
    all: () => request('/seating/tables'),
    createTable: (data: Record<string, unknown>) => request('/seating/tables', { method: 'POST', body: data }),
    updateTable: (id: string, data: Record<string, unknown>) => request(`/seating/tables/${id}`, { method: 'PUT', body: data }),
    deleteTable: (id: string) => request(`/seating/tables/${id}`, { method: 'DELETE' }),
    assign: (data: Record<string, unknown>) => request('/seating/assignments', { method: 'POST', body: data }),
    unassign: (assignmentId: string) => request(`/seating/assignments/${assignmentId}`, { method: 'DELETE' }),
    clearTable: (tableId: string) => request(`/seating/assignments/table/${tableId}`, { method: 'DELETE' }),
    room: () => request<{ width: number; height: number }>('/seating/room'),
    updateRoom: (data: { width: number; height: number }) => request<{ width: number; height: number }>('/seating/room', { method: 'PUT', body: data }),
  },
  logistics: {
    list: () => request('/logistics'),
    create: (data: Record<string, unknown>) => request('/logistics', { method: 'POST', body: data }),
    update: (id: string, data: Record<string, unknown>) => request(`/logistics/${id}`, { method: 'PUT', body: data }),
    remove: (id: string) => request(`/logistics/${id}`, { method: 'DELETE' }),
  },
  weddingDay: {
    runSheet: () => request('/wedding-day/run-sheet'),
    createRunSheet: (data: Record<string, unknown>) => request('/wedding-day/run-sheet', { method: 'POST', body: data }),
    updateRunSheet: (id: string, data: Record<string, unknown>) => request(`/wedding-day/run-sheet/${id}`, { method: 'PUT', body: data }),
    deleteRunSheet: (id: string) => request(`/wedding-day/run-sheet/${id}`, { method: 'DELETE' }),
    contacts: () => request('/wedding-day/contacts'),
    createContact: (data: Record<string, unknown>) => request('/wedding-day/contacts', { method: 'POST', body: data }),
    updateContact: (id: string, data: Record<string, unknown>) => request(`/wedding-day/contacts/${id}`, { method: 'PUT', body: data }),
    deleteContact: (id: string) => request(`/wedding-day/contacts/${id}`, { method: 'DELETE' }),
    packing: () => request('/wedding-day/packing'),
    createPacking: (data: Record<string, unknown>) => request('/wedding-day/packing', { method: 'POST', body: data }),
    updatePacking: (id: string, data: Record<string, unknown>) => request(`/wedding-day/packing/${id}`, { method: 'PUT', body: data }),
    deletePacking: (id: string) => request(`/wedding-day/packing/${id}`, { method: 'DELETE' }),
  },
  events: {
    list: () => request('/events'),
    create: (data: Record<string, unknown>) => request('/events', { method: 'POST', body: data }),
    update: (id: string, data: Record<string, unknown>) => request(`/events/${id}`, { method: 'PUT', body: data }),
    remove: (id: string) => request(`/events/${id}`, { method: 'DELETE' }),
  },
  rsvp: {
    list: (status?: string) => request('/rsvp', { params: { status } }),
    lastImport: () => request('/rsvp/last-import'),
    import: (responses: Record<string, unknown>[]) => request('/rsvp/import', { method: 'POST', body: { responses } }),
    match: (id: string, guestId: string) => request(`/rsvp/${id}/match`, { method: 'PATCH', body: { guest_id: guestId } }),
    review: (id: string, action: 'accepted' | 'rejected' | 'flagged', notes?: string) =>
      request(`/rsvp/${id}/review`, { method: 'PATCH', body: { action, notes } }),
    bulkReview: (ids: string[], action: 'accepted' | 'rejected' | 'flagged') =>
      request('/rsvp/bulk-review', { method: 'POST', body: { ids, action } }),
    window: () => request<{
      rsvp_open: boolean;
      rsvp_opens_at: string;
      rsvp_closes_at: string;
      guest_mode: 'teaser' | 'countdown' | 'rsvp' | 'weddingday' | 'thankyou';
      live_mode: 'teaser' | 'countdown' | 'rsvp' | 'weddingday' | 'thankyou';
      teaser_live_at: string;
      countdown_live_at: string;
      rsvp_live_at: string;
      weddingday_live_at: string;
      thankyou_live_at: string;
      go_public_date: string;
      wedding_date: string;
    }>('/rsvp/window'),
    updateWindow: (data: { guest_mode?: 'teaser' | 'countdown' | 'rsvp' | 'weddingday' | 'thankyou'; rsvp_open?: boolean; rsvp_opens_at?: string; rsvp_closes_at?: string; teaser_live_at?: string; countdown_live_at?: string; rsvp_live_at?: string; weddingday_live_at?: string; thankyou_live_at?: string; go_public_date?: string }) =>
      request('/rsvp/window', { method: 'PUT', body: data }),
    exportCsv: () => `/api/export/all`,
    questions: {
      list: () => request<Array<{ id: string; question: string; field_type: string; options: string; required: number; order_index: number }>>('/rsvp-questions'),
      create: (data: Record<string, unknown>) => request('/rsvp-questions', { method: 'POST', body: data }),
      update: (id: string, data: Record<string, unknown>) => request(`/rsvp-questions/${id}`, { method: 'PUT', body: data }),
      remove: (id: string) => request(`/rsvp-questions/${id}`, { method: 'DELETE' }),
    },
    reminders: {
      list: () => request<{ log: Array<{ at: string; household_id: string; household_name: string; note?: string }>; pending: Array<{ household_id: string; household_name: string; pending_count: number }> }>('/rsvp/reminders'),
      send: (householdIds: string[], note?: string) =>
        request<{ status: string; sent_at: string; count: number; emailed: { attempted: number; sent: number; failed: number } | null }>('/rsvp/reminders', { method: 'POST', body: { household_ids: householdIds, note: note || '' } }),
    },
    qrSheet: () => request<{ households: Array<{ household_id: string; household_name: string; guest_count: number; confirmed_count: number; declined_count: number; access_code: string; qr_payload: string; rsvp_link: string }> }>('/rsvp/qr-sheet'),
    songs: () => request<Array<{ guest_id: string; guest_name: string; household_name: string; status: string; attendance_type: string; song_request: string; updated_at: string }>>('/rsvp/songs'),
  },
  // ---------------------------------------------------------------------------
  // Guest portal (Feature #1) — public namespace. Worker seams byte-verified:
  //   POST /api/guest/access   (auth:false) → household + guests + questions
  //   POST /api/guest/rsvp     (auth:false) → household RSVP submit
  //   GET  /api/guest/home     (auth:false) → mode + countdown + window
  //   QR/qr-sheet/copy-link/reminders (additive admin additions).
  // No plan-site login required by the browser; preview hosts (v1/v2/v3) are
  // additionally hard-gated server-side per the couple's refinement.
  // ---------------------------------------------------------------------------
  guestSite: {
    get: () => request<{ draft: any; published: any; published_at: string; views: number; rsvp_started: number; meal_options: string[]; events: any[] }>('/guest-site'),
    save: (data: { draft?: any; meal_options?: string[] }) => request<{ draft: any; meal_options: string[] }>('/guest-site', { method: 'PUT', body: data }),
    publish: () => request<{ published: any; published_at: string }>('/guest-site/publish', { method: 'POST' }),
  },
  guest: {
    site: (draft?: boolean) =>
      request<GuestSiteData>(draft ? '/guest/site?draft=1' : '/guest/site'),
    unlock: (payload: { code: string }) =>
      request<{ unlocked: boolean; site: GuestSiteData }>('/guest/site/unlock', { method: 'POST', body: payload }),
    home: () =>
      request<{
        success: boolean;
        data?: {
          mode: 'teaser' | 'countdown' | 'rsvp';
          couple: { name_one: string; name_two: string };
          wedding_date: string;
          venue: string;
          countdown_target: string;
          rsvp_open: boolean;
          rsvp_opens_at: string;
          rsvp_closes_at: string;
          go_public_date: string;
          preview_ended: boolean;
          access_required: boolean;
        };
        error?: string;
      }>('/guest/home'),
    access: (payload: { code: string }) =>
      request<{
        success: boolean;
        data?: {
          household: { id: string; name: string };
          guests: Array<{
            id: string;
            first_name: string;
            last_name: string;
            is_primary: number;
            status: string;
            attendance_type: string;
            email: string;
            phone: string;
            dietary_needs: string;
            dietary_choice: string;
            song_request: string;
            accessibility_requests: string;
            plus_one_of: string | null;
            plus_one_allowed: boolean;
            plus_one_response: string;
            name_pending: boolean;
            rsvp_message: string;
          }>;
          questions: Array<{
            id: string;
            question: string;
            question_type: string;
            options: string[];
            is_required: boolean;
          }>;
          rsvp_open: boolean;
          rsvp_opens_at: string;
          rsvp_closes_at: string;
          meal_options: string[];
          window_state: 'open' | 'not_yet_open' | 'closed';
          already_responded: boolean;
          rsvp_submitted_at: string;
        };
        error?: string;
      }>('/guest/access', { method: 'POST', body: payload }),
    rsvp: (payload: {
      code: string;
      contact?: { email?: string; phone?: string };
      household?: { name?: string; address_line1?: string; address_line2?: string; city?: string; postcode?: string; country?: string };
      responses: Array<{
        guest_id: string;
        attending: boolean;
        attendance_type: string;
        dietary_needs: string;
        dietary_choice: string;
        song_request: string;
        accessibility_requests: string;
        rsvp_message: string;
        plus_one?: { bringing: boolean; first_name: string; last_name: string; dietary_needs: string; dietary_choice: string };
        answers?: Array<{ question_id: string; answer: string }>;
      }>;
    }) => request('/guest/rsvp', { method: 'POST', body: payload }),
    dietaryMatrix: () =>
      request<{
        groups: Array<{ key: string; label: string; guests: MatrixGuest[] }>;
        guests: MatrixGuest[];
        summary: {
          total: number;
          attending: number;
          with_dietary: number;
          with_contact: number;
          seated: number;
          meals: Record<string, number>;
        };
      }>('/rsvp/dietary-matrix'),
  },
  // ---------------------------------------------------------------------------
  // Email & reminders: guest emails, the daily brief and the email assistant,
  // all sent from one mailbox. Configuration lives in the Worker's variables
  // and secrets (Cloudflare), so it is read-only here.
  // ---------------------------------------------------------------------------
  assistant: {
    status: () =>
      request<{
        configured: boolean;
        mailbox: string;
        model: string;
        dry_run: boolean;
        recent: Array<{
          id: string;
          kind: string;
          from_email: string;
          subject: string;
          mode: string;
          status: string;
          reason: string;
          reply_text: string;
          actions: Array<{ tool: string; summary: string; simulated?: boolean }>;
          created_at: string;
        }>;
      }>('/assistant/status'),
    run: () => request<{ configured: boolean; fetched: number; done: number; ignored: number; failed: number; error?: string }>('/assistant/run', { method: 'POST' }),
  },
  email: {
    config: () =>
      request<{
        configured: boolean;
        dry_run: boolean;
        from_name: string;
        from_address: string;
        couple_emails: string[];
        digest_enabled: boolean;
        digest_time: string;
        assistant: { configured: boolean; model: string; dry_run: boolean };
      }>('/email/config'),
    test: (to?: string, sendToBoth?: boolean) => request<{ results: Array<{ to: string; ok: boolean; id: string; dry_run: boolean; error: string }>; all_ok: boolean }>('/email/test', { method: 'POST', body: { to: to || '', send_to_both: sendToBoth } }),
    digest: {
      preview: () => request<{ subject: string; text: string; html: string }>('/email/digest'),
      send: () =>
        request<{ subject: string; count: number; status: string; dry_run: boolean; provider_id: string; error: string }>('/email/digest', { method: 'POST' }),
    },
    audience: (audience: string, householdId?: string) =>
      request<{
        audience: string;
        total: number;
        skipped_count: number;
        skipped: Array<{ household_id: string; household_name: string }>;
        recipients: Array<{ email: string; name: string; household_id: string; household_name: string; status: string; code: string }>;
      }>('/email/audience', { params: { audience, household_id: householdId } }),
    campaigns: {
      list: () =>
        request<Array<{ id: string; kind: string; subject: string; audience: string; recipient_count: number; status: string; dry_run: number; error: string; sent_at: string; created_at: string }>>('/email/campaigns'),
      get: (id: string) =>
        request<{ campaign: Record<string, unknown> & { body_html?: string }; log: Array<{ id: string; to_email: string; to_name: string; subject: string; status: string; provider_id: string; error: string; sent_at: string }> }>(`/email/campaigns/${id}`),
      create: (data: { subject: string; body: string; body_html?: string; audience: string; household_id?: string }) =>
        request<{ campaign_id: string; count: number; sent: number; failed: number; status: string; dry_run: boolean }>('/email/campaigns', { method: 'POST', body: data }),
      preview: (data: { subject: string; body: string; body_html?: string }) =>
        request<{ subject: string; text: string; html: string }>('/email/campaigns/preview', { method: 'POST', body: data }),
      testDraft: (data: { subject: string; body: string; body_html?: string }) =>
        request<{ subject: string; count: number; status: string; dry_run: boolean }>('/email/campaigns/test-draft', { method: 'POST', body: data }),
    },
  },
};
