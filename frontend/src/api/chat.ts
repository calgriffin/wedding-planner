/**
 * In-app assistant chat + push notification API (worker/src/routes/chat.js).
 * Every chat call carries this browser's device id, so the Worker doesn't
 * ping a device about its own messages.
 */
import { request } from './client';
import { deviceId } from '../utils/device';

export interface ChatQuestion {
  id: string;
  question: string;
  options: string[];
  about: string;
  answer: string | null;
  answered_by: string;
  answered_by_name: string;
  answered_at: string | null;
  skipped?: boolean;
}

export interface NotifyPrefs {
  level: 'all' | 'questions';
  quiet_start: string; // 'HH:MM' UK time, '' = no quiet hours
  quiet_end: string;
}

export interface UsageTotals {
  runs: number;
  input: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
  cost: number;
  unpriced: number;
}

export interface UsagePeriod {
  total: UsageTotals;
  bySource: Record<string, UsageTotals>;
  byPerson: Record<string, UsageTotals>;
}

export interface UsageReport {
  currency: 'USD';
  prices_as_of: string;
  default_model: string;
  prices: Record<string, { input: number; output: number; cacheRead: number }>;
  estimated_runs: number;
  periods: { today: UsagePeriod; month: UsagePeriod; last30: UsagePeriod; all: UsagePeriod };
  by_month: (UsageTotals & { month: string })[];
  by_model: (UsageTotals & { model: string; priced: boolean })[];
}

export interface ChatAction {
  tool: string;
  summary: string;
  simulated?: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'event';
  author_email: string;
  author_name: string;
  text: string;
  status: 'done' | 'thinking' | 'failed';
  reason: string;
  actions: ChatAction[];
  attachments: { name: string; type: string; size: number }[];
  questions: ChatQuestion[];
  reply_to: { message_id: string; question_id: string; question: string } | null;
  dry_run: boolean;
  created_at: string;
  updated_at: string;
}

export interface ChatPending {
  code: string;
  message_id: string;
  summary: string;
  status: 'pending' | 'running' | 'confirmed' | 'cancelled' | 'failed';
  result: string;
  resolved_by_name: string;
  created_at: string;
  resolved_at: string | null;
}

export interface ChatConversationSummary {
  id: string;
  title: string;
  kind: 'chat' | 'checkin' | 'email';
  created_by_name: string;
  archived: boolean;
  created_at: string;
  updated_at: string;
  last_text: string;
  last_author_name: string;
  unread: boolean;
  open_questions: number;
  pending_count: number;
  thinking: boolean;
}

export interface ChatConversation {
  conversation: { id: string; title: string; kind: string; archived: boolean; created_by_name: string; created_at: string; updated_at: string };
  messages: ChatMessage[];
  pending: ChatPending[];
}

export interface ChatMe {
  email: string;
  name: string;
  can_rename: boolean;
  couple: { email: string; name: string }[];
  ai: { configured: boolean; model: string; dry_run: boolean; checkin: boolean; checkin_time: string };
  email_fallback: boolean;
  notify: NotifyPrefs;
  push: {
    public_key: string;
    devices: { id: string; label: string; name: string; mine: boolean; this_device: boolean; created_at: string; last_success_at: string | null }[];
  };
}

export interface ChatAttachment {
  name: string;
  type: string;
  data: string; // base64, no data: prefix
}

const h = () => ({ 'X-Device-Id': deviceId() });

export const chatApi = {
  me: () => request<ChatMe>('/chat/me', { params: { device: deviceId() } }),
  setName: (name: string) => request<{ name: string }>('/chat/me', { method: 'PUT', body: { name } }),
  setNotify: (notify: NotifyPrefs) => request<{ notify: NotifyPrefs }>('/chat/me', { method: 'PUT', body: { notify } }),
  skip: (messageId: string, questionId: string) =>
    request<{ skipped: boolean }>(`/chat/questions/${encodeURIComponent(messageId)}/${encodeURIComponent(questionId)}/skip`, { method: 'POST', body: {} }),
  usage: () => request<UsageReport>('/ai/usage'),
  unread: () => request<{ unread: number; open_questions: number; pending: number }>('/chat/unread'),
  list: (archived = false) => request<ChatConversationSummary[]>('/chat/conversations', { params: { archived: archived ? 1 : undefined } }),
  create: (title?: string) => request<{ id: string; title: string }>('/chat/conversations', { method: 'POST', body: { title: title || '' } }),
  get: (id: string) => request<ChatConversation>(`/chat/conversations/${encodeURIComponent(id)}`),
  update: (id: string, patch: { title?: string; archived?: boolean }) =>
    request<ChatConversation>(`/chat/conversations/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch }),
  send: (id: string, body: { text: string; attachments?: ChatAttachment[]; answer_to?: { message_id: string; question_id: string } }) =>
    request<ChatConversation>(`/chat/conversations/${encodeURIComponent(id)}/messages`, { method: 'POST', body, headers: h() }),
  confirm: (code: string) => request<{ status: string; result: string }>(`/chat/pending/${encodeURIComponent(code)}/confirm`, { method: 'POST', body: {}, headers: h() }),
  cancel: (code: string) => request<{ status: string; result: string }>(`/chat/pending/${encodeURIComponent(code)}/cancel`, { method: 'POST', body: {}, headers: h() }),
  // status: 'asked' | 'nothing to ask' | 'open questions' (conversationId = where they wait) | 'already running' | 'failed' | 'not configured'
  checkin: () => request<{ status: string; count: number; conversationId?: string; problem?: string }>('/chat/checkin', { method: 'POST', body: {} }),
  push: {
    subscribe: (sub: PushSubscriptionJSON, label: string) =>
      request<{ subscribed: boolean }>('/push/subscriptions', { method: 'POST', body: { ...sub, label, device_id: deviceId() }, headers: h() }),
    unsubscribe: (body: { endpoint?: string; id?: string }) => request<{ unsubscribed: boolean }>('/push/unsubscribe', { method: 'POST', body }),
    test: (endpoint: string) => request<{ sent: boolean }>('/push/test', { method: 'POST', body: { endpoint } }),
  },
};
