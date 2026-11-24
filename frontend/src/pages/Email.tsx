/**
 * Email & Reminders: the email assistant, the morning brief it writes, and
 * Mailchimp-style sending to guests — all from the planner's own mailbox.
 * Settings live in the Worker's variables (Cloudflare), so they are shown
 * here but not edited.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';
import { api } from '../api/client';
import { brand } from '../utils/brand';
import {
  PageHeader, Card, Badge, Button, Field, Input, Select, Textarea, Spinner, Modal, ConfirmDialog, EmptyState, DataTable,
} from '../components/ui';

const AUDIENCES = [
  { id: 'all', label: 'Everyone (all households with an email)' },
  { id: 'unresponded', label: 'Not replied yet (RSVP pending)' },
  { id: 'confirmed', label: 'Confirmed (coming)' },
  { id: 'declined', label: 'Declined' },
  { id: 'household', label: 'A specific household…' },
];

const KIND_LABEL: Record<string, string> = {
  couple_reminder: 'Morning brief',
  guest_campaign: 'Guest email',
  rsvp_reminder: 'RSVP reminder',
};

// Sandboxed render of an email's HTML (no Tailwind bleed, no scripts).
const EmailFrame = ({ html, width = 'desktop' }: { html: string; width?: 'desktop' | 'mobile' }) => (
  <div className="flex justify-center rounded-lg bg-charcoal-100/60 border border-charcoal-200 p-3">
    <iframe
      title="Email preview"
      sandbox=""
      srcDoc={html}
      className="rounded-md border border-charcoal-200 bg-white"
      style={{ width: width === 'mobile' ? 375 : '100%', maxWidth: 600, height: 520 }}
    />
  </div>
);

export default function EmailPage() {
  const { showToast } = useApp();
  const [config, setConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [households, setHouseholds] = useState<any[]>([]);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [testing, setTesting] = useState(false);

  // Email assistant
  const [assistant, setAssistant] = useState<any>(null);
  const [checking, setChecking] = useState(false);
  const [openActivity, setOpenActivity] = useState<any>(null);

  // Compose form
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [bodyHtml, setBodyHtml] = useState('');
  const [composeTab, setComposeTab] = useState<'plain' | 'html' | 'preview'>('plain');
  const [previewDevice, setPreviewDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [composePreview, setComposePreview] = useState<any>(null);
  const [compositionLoading, setCompositionLoading] = useState(false);
  const [draftTesting, setDraftTesting] = useState(false);
  const [audience, setAudience] = useState('all');
  const [householdId, setHouseholdId] = useState('');
  const [preview, setPreview] = useState<any>(null);
  const [previewing, setPreviewing] = useState(false);
  const [confirmSend, setConfirmSend] = useState(false);
  const [sending, setSending] = useState(false);

  // Digest
  const [digestPreview, setDigestPreview] = useState<any>(null);
  const [digestLoading, setDigestLoading] = useState(false);
  const [digestTab, setDigestTab] = useState<'text' | 'rendered'>('text');
  const [confirmDigest, setConfirmDigest] = useState(false);

  // History
  const [detail, setDetail] = useState<any>(null);
  const [detailTab, setDetailTab] = useState<'text' | 'rendered'>('rendered');

  const load = async () => {
    setLoading(true);
    try {
      const [cfg, hs, cs, as] = await Promise.all([
        api.email.config(),
        api.households.list() as Promise<any[]>,
        api.email.campaigns.list(),
        api.assistant.status(),
      ]);
      setConfig(cfg);
      setAssistant(as);
      setHouseholds(hs || []);
      setCampaigns(cs || []);
    } catch (e: any) {
      showToast(e.message || 'Failed to load email settings', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const checkMailbox = async () => {
    setChecking(true);
    try {
      const res = await api.assistant.run();
      if (res.error) showToast(`Couldn't check the mailbox: ${res.error}`, 'error');
      else showToast(res.fetched ? `Checked — ${res.done} handled, ${res.ignored} ignored, ${res.failed} failed` : 'Checked — no new email', res.failed ? 'error' : 'success');
      setAssistant(await api.assistant.status());
    } catch (e: any) {
      showToast(e.message || 'Failed to check the mailbox', 'error');
    } finally {
      setChecking(false);
    }
  };

  const sendTest = async () => {
    setTesting(true);
    try {
      const res = await api.email.test('', true); // send to both
      const allOk = res.all_ok;
      const msg = allOk
        ? (res.results?.[0]?.dry_run ? 'Test emails simulated ✓' : 'Test emails sent ✓')
        : `Test failed: ${res.results?.find((r: any) => !r.ok)?.error || 'unknown error'}`;
      showToast(msg, allOk ? 'success' : 'error');
    } catch (e: any) {
      showToast(e.message, 'error');
    } finally {
      setTesting(false);
    }
  };

  const loadDigestPreview = async () => {
    setDigestLoading(true);
    try {
      setDigestPreview(await api.email.digest.preview());
    } catch (e: any) {
      showToast(e.message || 'Failed to write the brief', 'error');
    } finally {
      setDigestLoading(false);
    }
  };

  const sendDigest = async () => {
    setSending(true);
    setConfirmDigest(false);
    try {
      const res = await api.email.digest.send();
      showToast(res.dry_run ? `Brief simulated (${res.status}) ✓` : `Brief sent (${res.status}) ✓`, res.status === 'sent' ? 'success' : 'error');
      load();
    } catch (e: any) {
      showToast(e.message || 'Failed to send the brief', 'error');
    } finally {
      setSending(false);
    }
  };

  const loadPreview = async () => {
    setPreviewing(true);
    setPreview(null);
    try {
      setPreview(await api.email.audience(audience, audience === 'household' ? householdId : undefined));
    } catch (e: any) {
      showToast(e.message || 'Failed to preview recipients', 'error');
    } finally {
      setPreviewing(false);
    }
  };

  const sendCampaign = async () => {
    if (!subject.trim()) { showToast('Add a subject', 'error'); return; }
    if (!body.trim() && !bodyHtml.trim()) { showToast('Add a message', 'error'); return; }
    setSending(true);
    setConfirmSend(false);
    try {
      const res = await api.email.campaigns.create({
        subject: subject.trim(),
        body: body.trim(),
        body_html: bodyHtml.trim() || undefined,
        audience,
        household_id: audience === 'household' ? householdId : undefined,
      });
      showToast(
        res.dry_run ? `Simulated — ${res.sent}/${res.count} logged ✓` : `Sent — ${res.sent}/${res.count} ✓`,
        res.failed > 0 ? 'error' : 'success'
      );
      setSubject(''); setBody(''); setBodyHtml(''); setPreview(null); setComposePreview(null);
      load();
    } catch (e: any) {
      showToast(e.message || 'Failed to send', 'error');
    } finally {
      setSending(false);
    }
  };

  const insertTag = (tag: string) => {
    if (composeTab === 'html') setBodyHtml((b) => `${b}${b ? '\n' : ''}${tag}`);
    else setBody((b) => `${b}${b ? '\n' : ''}${tag}`);
  };

  const loadComposePreview = async () => {
    setCompositionLoading(true);
    setComposePreview(null);
    try {
      setComposePreview(await api.email.campaigns.preview({
        subject: subject.trim() || 'Subject',
        body: body.trim(),
        body_html: bodyHtml.trim() || undefined,
      }));
    } catch (e: any) {
      showToast(e.message || 'Failed to render preview', 'error');
    } finally {
      setCompositionLoading(false);
    }
  };

  const sendDraftTest = async () => {
    if (!subject.trim()) { showToast('Add a subject first', 'error'); return; }
    if (!body.trim() && !bodyHtml.trim()) { showToast('Add a message first', 'error'); return; }
    setDraftTesting(true);
    try {
      const res = await api.email.campaigns.testDraft({
        subject: subject.trim(),
        body: body.trim(),
        body_html: bodyHtml.trim() || undefined,
      });
      showToast(res.dry_run ? 'Test draft simulated ✓' : 'Test draft sent to your inbox ✓', 'success');
      load();
    } catch (e: any) {
      showToast(e.message || 'Failed to send test draft', 'error');
    } finally {
      setDraftTesting(false);
    }
  };

  const openDetail = async (id: string) => {
    try {
      setDetail(await api.email.campaigns.get(id));
    } catch (e: any) {
      showToast(e.message || 'Failed to load campaign', 'error');
    }
  };

  const configured = config ? config.configured : false;
  const coupleEmails: string[] = config?.couple_emails || [];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Email & Reminders"
        subtitle="Your email assistant, the morning brief it writes for you, guest updates and RSVP nudges — all sent from the planner's own mailbox."
        badge={configured ? <Badge tone="sage">Configured</Badge> : <Badge tone="neutral">Not configured</Badge>}
      />

      {config?.dry_run && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <strong>Simulation mode is on.</strong> Emails are logged as sent (provider id <code className="font-mono">dry-…</code>) but nothing is delivered. Remove <code className="font-mono">EMAIL_DRY_RUN</code> in Cloudflare when you're ready to send for real.
        </div>
      )}

      {/* Settings (read-only: they live in Cloudflare) */}
      <Card
        title="Settings"
        subtitle="Set in Cloudflare → your Worker → Settings → Variables and Secrets. Shown here so you can check them."
        actions={<Button variant="outline" size="sm" loading={testing} disabled={!configured || !coupleEmails.length} onClick={sendTest}>Send test to us</Button>}
      >
        <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <div>
            <dt className="text-charcoal-500">Sends from</dt>
            <dd className="text-charcoal-800">{config?.from_address ? `${config.from_name} <${config.from_address}>` : 'No mailbox set'}</dd>
          </div>
          <div>
            <dt className="text-charcoal-500">Your addresses</dt>
            <dd className="text-charcoal-800">{coupleEmails.length ? coupleEmails.join(', ') : 'None set'}</dd>
          </div>
          <div>
            <dt className="text-charcoal-500">Morning brief</dt>
            <dd className="text-charcoal-800">{config?.digest_enabled ? `Every day at ${config.digest_time} (UK time)` : 'Off'}</dd>
          </div>
          <div>
            <dt className="text-charcoal-500">Assistant</dt>
            <dd className="text-charcoal-800">
              {config?.assistant?.configured ? `On (${config.assistant.model})${config.assistant.dry_run ? ', simulation: replies but saves nothing' : ''}` : 'Off — no Claude API key set'}
            </dd>
          </div>
        </dl>
      </Card>

      {/* Email assistant */}
      <Card
        title="Email assistant"
        subtitle={assistant?.mailbox
          ? `Email or forward anything to ${assistant.mailbox} and it updates the plan and replies to you both. Copy it in on supplier emails and it files them and sends you a separate note. It checks every 15 minutes.`
          : 'Not set up yet.'}
        actions={<Button variant="outline" size="sm" loading={checking} disabled={!assistant?.configured} onClick={checkMailbox}>Check mailbox now</Button>}
      >
        {assistant?.recent?.length ? (
          <ul className="divide-y divide-charcoal-100">
            {assistant.recent.map((m: any) => (
              <li key={m.id}>
                <button onClick={() => setOpenActivity(m)} className="w-full flex items-center justify-between gap-3 py-2 text-left hover:bg-ivory-50">
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-charcoal-800">{m.subject || '(no subject)'}</span>
                    <span className="block truncate text-xs text-charcoal-500">
                      {m.kind === 'brief' ? 'Morning brief' : m.from_email}
                      {m.actions?.length ? ` · ${m.actions.length} change${m.actions.length === 1 ? '' : 's'}` : ''}
                      {m.reason ? ` · ${m.reason}` : ''}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="text-xs text-charcoal-400">{new Date(m.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                    <Badge tone={m.status === 'done' ? 'sage' : m.status === 'failed' ? 'warning' : 'neutral'}>{m.status}</Badge>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-charcoal-400">Nothing yet. Send it an email to try it.</p>
        )}
      </Card>

      {/* Digest to yourselves */}
      <Card
        title="Your morning brief"
        subtitle={`${config?.digest_enabled ? `Sent to you both at ${config?.digest_time} (UK time)` : 'Switched off'}. ${config?.assistant?.configured ? 'Written each morning by your assistant from the plan' : 'A plain summary of the plan'}: what needs doing, what's overdue and what's coming up. Reply to it to update the plan.`}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" loading={digestLoading} onClick={loadDigestPreview}>Preview today's</Button>
            <Button size="sm" disabled={!configured || !coupleEmails.length} onClick={() => setConfirmDigest(true)}>Email us now</Button>
          </div>
        }
      >
        {!configured && (
          <p className="text-sm text-charcoal-500">Email isn't set up yet — see Settings above.</p>
        )}
        {digestPreview ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-charcoal-800">{digestPreview.subject}</p>
              <div className="flex rounded-md border border-charcoal-200 overflow-hidden text-xs">
                <button onClick={() => setDigestTab('text')} className={`px-3 py-1 ${digestTab === 'text' ? 'bg-sage-500 text-white' : 'bg-white text-charcoal-600 hover:bg-ivory-50'}`}>Plain</button>
                <button onClick={() => setDigestTab('rendered')} className={`px-3 py-1 ${digestTab === 'rendered' ? 'bg-sage-500 text-white' : 'bg-white text-charcoal-600 hover:bg-ivory-50'}`}>Rendered</button>
              </div>
            </div>
            {digestTab === 'rendered' && digestPreview.html ? (
              <EmailFrame html={digestPreview.html} />
            ) : (
              <pre className="whitespace-pre-wrap text-[13px] leading-relaxed text-charcoal-600 bg-ivory-50 border border-charcoal-200 rounded-lg p-4 max-h-80 overflow-y-auto">{digestPreview.text}</pre>
            )}
          </div>
        ) : (
          <p className="text-sm text-charcoal-400">Hit “Preview today's” to see what this morning's email would say.</p>
        )}
      </Card>

      {/* Compose + send to guests */}
      <Card
        title="Email guests"
        subtitle="Compose once, choose who gets it. One email per household, addressed to everyone in it.  Sent from your planner's mailbox."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" loading={previewing} onClick={loadPreview}>Preview recipients</Button>
            <Button variant="outline" size="sm" loading={draftTesting} disabled={!configured || !subject.trim() || (!body.trim() && !bodyHtml.trim())} onClick={sendDraftTest}>Send test to us</Button>
            <Button size="sm" disabled={!configured || !subject.trim() || (!body.trim() && !bodyHtml.trim())} onClick={() => setConfirmSend(true)}>Send</Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Audience">
              <Select value={audience} onChange={(e) => setAudience(e.target.value)}>
                {AUDIENCES.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
              </Select>
            </Field>
            <Field label="Subject">
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject line" />
            </Field>
          </div>
          {audience === 'household' && (
            <Field label="Household">
              <Select value={householdId} onChange={(e) => setHouseholdId(e.target.value)}>
                <option value="">Select a household…</option>
                {households.filter((h) => h.id).map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
              </Select>
            </Field>
          )}

          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex rounded-md border border-charcoal-200 overflow-hidden text-sm">
                <button onClick={() => setComposeTab('plain')} className={`px-4 py-1.5 ${composeTab === 'plain' ? 'bg-sage-500 text-white' : 'bg-white text-charcoal-600 hover:bg-ivory-50'}`}>Plain text</button>
                <button onClick={() => setComposeTab('html')} className={`px-4 py-1.5 ${composeTab === 'html' ? 'bg-sage-500 text-white' : 'bg-white text-charcoal-600 hover:bg-ivory-50'}`}>HTML</button>
                <button onClick={() => { setComposeTab('preview'); loadComposePreview(); }} className={`px-4 py-1.5 ${composeTab === 'preview' ? 'bg-sage-500 text-white' : 'bg-white text-charcoal-600 hover:bg-ivory-50'}`}>Preview</button>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-charcoal-400">Merge:</span>
                {['{name}', '{code}', '{rsvp_button}'].map((t) => (
                  <button key={t} onClick={() => insertTag(t)} className="rounded-full border border-sage-300 bg-sage-50 px-2 py-0.5 font-mono text-xs text-sage-700 hover:bg-sage-100" title={`Insert ${t}`}>+ {t}</button>
                ))}
              </div>
            </div>

            {composeTab === 'plain' && (
              <Textarea rows={8} value={body} onChange={(e) => setBody(e.target.value)} placeholder={"Hi {name}, just a quick note from the two of us…\n\n{rsvp_button}"} />
            )}
            {composeTab === 'html' && (
              <div>
                <Textarea rows={8} value={bodyHtml} onChange={(e) => setBodyHtml(e.target.value)} placeholder={'<p>Hi {name},</p>\n<p>Your message here…</p>\n{rsvp_button}'} className="font-mono text-[13px]" />
                <p className="text-xs text-charcoal-400 mt-1">Advanced: full HTML, wrapped in the wedding-brand shell when sent. <code>{'{name}'}</code>, <code>{'{code}'}</code>, <code>{'{rsvp_url}'}</code> and <code>{'{rsvp_button}'}</code> are replaced per household.</p>
              </div>
            )}
            {composeTab === 'preview' && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-charcoal-500">Shown with sample data (<span className="font-mono">Sample Guest</span> · code <span className="font-mono">{brand.code}-DEMO</span>). {compositionLoading ? 'Rendering…' : ''}</p>
                  <div className="flex rounded-md border border-charcoal-200 overflow-hidden text-xs">
                    <button onClick={() => setPreviewDevice('desktop')} className={`px-3 py-1 ${previewDevice === 'desktop' ? 'bg-sage-500 text-white' : 'bg-white text-charcoal-600'}`}>Desktop</button>
                    <button onClick={() => setPreviewDevice('mobile')} className={`px-3 py-1 ${previewDevice === 'mobile' ? 'bg-sage-500 text-white' : 'bg-white text-charcoal-600'}`}>Mobile</button>
                  </div>
                </div>
                {composePreview?.html ? (
                  <EmailFrame html={composePreview.html} width={previewDevice} />
                ) : (
                  <div className="rounded-lg border border-dashed border-charcoal-300 p-8 text-center text-sm text-charcoal-400">
                    {compositionLoading ? 'Rendering preview…' : 'Switch to this tab to render a live preview of the draft.'}
                  </div>
                )}
              </div>
            )}
          </div>

          {preview && (
            <div className="rounded-lg border border-charcoal-200 bg-ivory-50 p-4">
              <p className="text-sm text-charcoal-700">
                <strong>{preview.total} household{preview.total === 1 ? '' : 's'}</strong> will get this email
                {preview.skipped_count > 0 && (
                  <span className="text-charcoal-500"> · {preview.skipped_count} household{preview.skipped_count === 1 ? '' : 's'} have no email address and will be skipped</span>
                )}
              </p>
              <div className="mt-3 grid sm:grid-cols-2 gap-x-4 gap-y-1">
                {preview.recipients.slice(0, 40).map((r: any, i: number) => (
                  <div key={i} className="flex items-center justify-between text-sm py-0.5 border-b border-charcoal-100 last:border-0">
                    <span className="text-charcoal-700 truncate">{r.name} <span className="text-charcoal-400">({r.household_name})</span></span>
                    <Badge tone={r.status === 'confirmed' ? 'sage' : r.status === 'declined' ? 'neutral' : 'warning'}>{r.status}</Badge>
                  </div>
                ))}
                {preview.recipients.length > 40 && (
                  <p className="text-xs text-charcoal-400 sm:col-span-2">…and {preview.recipients.length - 40} more.</p>
                )}
              </div>
            </div>
          )}
          {!preview && (
            <p className="text-xs text-charcoal-400">Preview who'll receive this before sending — the send shows a final confirmation with the count.</p>
          )}
        </div>
      </Card>

      {/* History */}
      <Card title="Send history" subtitle="Every digest, guest email and RSVP reminder run — with per-recipient status.">
        {campaigns.length ? (
          <DataTable
            rowKey={(r) => r.id}
            rows={campaigns}
            onRowClick={(r) => openDetail(r.id)}
            columns={[
              { key: 'sent_at', label: 'When', render: (r) => <span className="text-xs text-charcoal-500">{r.sent_at ? new Date(r.sent_at).toLocaleString() : '—'}</span> },
              { key: 'kind', label: 'Type', render: (r) => <Badge tone="neutral">{KIND_LABEL[r.kind] || r.kind}</Badge> },
              { key: 'subject', label: 'Subject', render: (r) => <span className="font-medium text-charcoal-800">{r.subject}</span> },
              { key: 'audience', label: 'Audience', render: (r) => <span className="text-sm text-charcoal-600">{r.audience}</span> },
              { key: 'recipient_count', label: 'Recipients', render: (r) => <span className="text-sm text-charcoal-600">{r.recipient_count}</span> },
              {
                key: 'status', label: 'Status', render: (r) => (
                  <Badge tone={r.status === 'sent' ? 'sage' : r.status === 'partial' ? 'warning' : 'danger'}>
                    {r.dry_run ? `simulated · ${r.status}` : r.status}
                    {r.error ? ` · ${r.error}` : ''}
                  </Badge>
                ),
              },
            ]}
          />
        ) : (
          <EmptyState title="Nothing sent yet" message="Your first digest or guest email will appear here with its full recipient log." />
        )}
      </Card>

      {/* Campaign detail modal */}
      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail?.campaign?.subject || 'Campaign'} size="lg">
        {detail && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge tone="neutral">{KIND_LABEL[detail.campaign.kind] || detail.campaign.kind}</Badge>
              <Badge tone={detail.campaign.status === 'sent' ? 'sage' : detail.campaign.status === 'partial' ? 'warning' : 'danger'}>{detail.campaign.status}</Badge>
              {detail.campaign.dry_run ? <Badge tone="neutral">simulated</Badge> : null}
              <span className="text-charcoal-500">{detail.campaign.recipient_count} recipient{detail.campaign.recipient_count === 1 ? '' : 's'}</span>
              <span className="text-charcoal-500">{detail.campaign.sent_at ? new Date(detail.campaign.sent_at).toLocaleString() : ''}</span>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs uppercase tracking-wide text-charcoal-400">Message</p>
                <div className="flex rounded-md border border-charcoal-200 overflow-hidden text-xs">
                  <button onClick={() => setDetailTab('rendered')} className={`px-3 py-0.5 ${detailTab === 'rendered' ? 'bg-sage-500 text-white' : 'bg-white text-charcoal-600 hover:bg-ivory-50'}`}>Rendered</button>
                  <button onClick={() => setDetailTab('text')} className={`px-3 py-0.5 ${detailTab === 'text' ? 'bg-sage-500 text-white' : 'bg-white text-charcoal-600 hover:bg-ivory-50'}`}>Plain</button>
                </div>
              </div>
              {detailTab === 'rendered' && detail.campaign.body_html ? (
                <EmailFrame html={detail.campaign.body_html} />
              ) : detailTab === 'rendered' ? (
                <p className="text-sm text-charcoal-400 py-2">No rendered snapshot for this campaign (sent before HTML previews).</p>
              ) : (
                <pre className="whitespace-pre-wrap text-[13px] leading-relaxed text-charcoal-700 bg-ivory-50 border border-charcoal-200 rounded-lg p-3 max-h-40 overflow-y-auto">{detail.campaign.body}</pre>
              )}
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-charcoal-400 mb-2">Recipients</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-charcoal-400 border-b border-charcoal-200">
                      <th className="py-2 pr-3">Name</th>
                      <th className="py-2 pr-3">Email</th>
                      <th className="py-2 pr-3">Status</th>
                      <th className="py-2">Provider</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.log.map((l: any) => (
                      <tr key={l.id} className="border-b border-charcoal-100">
                        <td className="py-2 pr-3 text-charcoal-800">{l.to_name || '—'}</td>
                        <td className="py-2 pr-3 text-charcoal-600">{l.to_email}</td>
                        <td className="py-2 pr-3">
                          <Badge tone={l.status === 'sent' ? 'sage' : 'danger'}>{l.status}{l.error ? ` — ${l.error}` : ''}</Badge>
                        </td>
                        <td className="py-2 font-mono text-xs text-charcoal-500">{l.provider_id}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!openActivity} onClose={() => setOpenActivity(null)} title={openActivity?.subject || 'Email'}>
        {openActivity && (
          <div className="space-y-3 text-sm">
            <p className="text-charcoal-500">
              {openActivity.kind === 'brief' ? 'Morning brief' : `From ${openActivity.from_email}`}
              {openActivity.mode === 'copied' ? ' · you copied it in, so it sent you a separate note' : ''}
              {openActivity.reason ? ` · ${openActivity.reason}` : ''}
            </p>
            {openActivity.actions?.length > 0 && (
              <div>
                <p className="font-medium text-charcoal-800">Changes made</p>
                <ul className="list-disc pl-5 text-charcoal-600">
                  {openActivity.actions.map((a: any, i: number) => <li key={i}>{a.summary}{a.simulated ? ' (simulation: not saved)' : ''}</li>)}
                </ul>
              </div>
            )}
            {openActivity.reply_text && (
              <pre className="whitespace-pre-wrap text-[13px] leading-relaxed text-charcoal-600 bg-ivory-50 border border-charcoal-200 rounded-lg p-4 max-h-96 overflow-y-auto">{openActivity.reply_text}</pre>
            )}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={confirmSend}
        onClose={() => setConfirmSend(false)}
        onConfirm={sendCampaign}
        title={`Send to ${preview?.total ?? '…'} household${preview?.total === 1 ? '' : 's'}?`}
        message={config?.dry_run ? 'Simulation mode is on — this will be logged as if sent, but no emails are delivered.' : `This will email ${preview?.total ?? 'the chosen'} household(s) immediately.`}
        confirmLabel="Send"
        danger={false}
      />
      <ConfirmDialog
        open={confirmDigest}
        onClose={() => setConfirmDigest(false)}
        onConfirm={sendDigest}
        title="Email the digest now?"
        message={config?.dry_run ? 'Simulation mode is on — the brief will be logged as sent, but not delivered.' : `Today's brief will be emailed to ${coupleEmails.join(' and ')}.`}
        confirmLabel="Email us"
        danger={false}
      />
    </div>
  );
}