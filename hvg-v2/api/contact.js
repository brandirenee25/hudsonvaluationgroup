// Hudson Valuation Group: contact form handler (Vercel Node function).
// Replaces Formspree. Sends (1) the inquiry to intake@ and (2) a confirmation to the client via Resend.
// Needs env var RESEND_API_KEY (set in Vercel project settings; never commit it).

const CONFIRMATION_TEMPLATE = require('./_lib/confirmation-template.js');

const INTAKE_TO = 'intake@hudsonvaluationgroup.com';
const INTAKE_FROM = 'Hudson Valuation Group <intake@hudsonvaluationgroup.com>';
const CLIENT_FROM = 'Brandi Hudson <brandi@hudsonvaluationgroup.com>';
const CLIENT_REPLY_TO = 'brandi@hudsonvaluationgroup.com';
const CLIENT_SUBJECT = 'We received your appraisal request | Hudson Valuation Group';

const THANK_YOU = '/thank-you.html?sent=1';
const ERROR_PAGE = '/contact.html?error=1';
const MIN_FILL_MS = 3000;

const PURPOSES = ['Estate / Trust', 'Date of Death', 'Divorce / Settlement', 'Pre-Listing', 'PMI Removal', 'Other'];
const COUNTIES = ['Contra Costa County', 'Alameda County', 'San Joaquin County', 'Other'];
const SOURCE_KEYS = ['landing_page', 'referrer', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'page_url'];
const HONEYPOT = 'company_website';

function redirect(res, location) {
  res.statusCode = 303;
  res.setHeader('Location', location);
  res.setHeader('Cache-Control', 'no-store');
  res.end();
}

async function readFields(req) {
  const body = req.body;
  if (body && typeof body === 'object' && !Buffer.isBuffer(body)) return body;
  let raw = body;
  if (raw === undefined) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    raw = Buffer.concat(chunks);
  }
  const type = String(req.headers['content-type'] || '');
  if (type.includes('multipart/form-data')) {
    const fd = await new Response(raw, { headers: { 'content-type': type } }).formData();
    return Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));
  }
  const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw || '');
  if (type.includes('application/json')) {
    try { return JSON.parse(text) || {}; } catch { return {}; }
  }
  return Object.fromEntries(new URLSearchParams(text));
}

function clean(v, max) {
  if (Array.isArray(v)) v = v[0];
  return String(v == null ? '' : v).replace(/\u0000/g, '').trim().slice(0, max);
}
function oneLine(v) {
  return v.replace(/[\r\n\t]+/g, ' ');
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function ptTimestamp(d) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'short',
  }).format(d);
}

// Minimal {{var}} / {{#if var}}...{{else}}...{{/if}} renderer for the approved template.
function renderTemplate(tpl, vars) {
  const innermostIf = /\{\{#if (\w+)\}\}((?:(?!\{\{#if )[\s\S])*?)\{\{\/if\}\}/;
  let out = tpl;
  let m;
  while ((m = innermostIf.exec(out))) {
    const [yes, no = ''] = m[2].split('{{else}}');
    out = out.slice(0, m.index) + (vars[m[1]] ? yes : no) + out.slice(m.index + m[0].length);
  }
  return out.replace(/\{\{(\w+)\}\}/g, (_, k) => esc(vars[k] || ''));
}

function buildConfirmation(f) {
  const firstName = f.name.split(/\s+/)[0] || 'there';
  const purpose = f.purpose && f.purpose !== 'Other' ? f.purpose : '';
  const county = f.county && f.county !== 'Other' ? f.county : '';
  let html = renderTemplate(CONFIRMATION_TEMPLATE, { first_name: firstName, purpose, county });
  // Grammar only: "a Estate / Trust appraisal" -> "an Estate / Trust appraisal".
  if (/^[AEIOU]/i.test(purpose)) html = html.replace('request for a ' + esc(purpose), 'request for an ' + esc(purpose));
  const text = [
    `Hi ${firstName},`,
    '',
    purpose
      ? `Thank you for reaching out to Hudson Valuation Group. I've received your request for ${/^[AEIOU]/i.test(purpose) ? 'an' : 'a'} ${purpose} appraisal${county ? ' in ' + county : ''}.`
      : `Thank you for reaching out to Hudson Valuation Group. I've received your appraisal request${county ? ' in ' + county : ''}.`,
    '',
    "What happens next: I'll review your details and reply with my fee and availability within one business day. Requests that arrive on a weekend or holiday are answered the next business day.",
    '',
    "If you're working against a deadline, like an attorney, court, or lender due date, just reply to this email and let me know.",
    '',
    'Save my contact information: https://www.hudsonvaluationgroup.com/brandi',
    '',
    'Brandi Hudson',
    'Hudson Valuation Group',
  ].join('\n');
  return { html, text };
}

function buildInquiry(f, src, receivedAt) {
  const rows = [
    ['Name', f.name], ['Email', f.email], ['Phone', f.phone], ['Property address', f.address],
    ['Purpose', f.purpose], ['County', f.county], ['Additional details', f.message],
  ];
  const sourceRows = [
    ['How did you hear about us', f.how_did_you_hear || '(not answered)'],
    ['Landing page', src.landing_page], ['Referrer', src.referrer || '(direct / none)'],
    ['UTM source', src.utm_source], ['UTM medium', src.utm_medium], ['UTM campaign', src.utm_campaign],
    ['UTM term', src.utm_term], ['UTM content', src.utm_content], ['gclid', src.gclid],
    ['Submitted from', src.page_url], ['Received', ptTimestamp(receivedAt)],
  ].filter(([, v]) => v);

  const table = (title, list) =>
    `<h3 style="font-family:Arial,sans-serif;font-size:14px;color:#a88b55;margin:20px 0 6px;text-transform:uppercase;letter-spacing:1px;">${title}</h3>` +
    '<table cellpadding="6" cellspacing="0" border="0" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px;width:100%;max-width:640px;">' +
    list.map(([k, v]) =>
      `<tr><td style="border-bottom:1px solid #eee;color:#555;width:170px;vertical-align:top;"><strong>${esc(k)}</strong></td>` +
      `<td style="border-bottom:1px solid #eee;vertical-align:top;white-space:pre-wrap;word-break:break-word;">${esc(v || '—')}</td></tr>`).join('') +
    '</table>';

  const html = `<div style="font-family:Arial,sans-serif;color:#1a1a1a;">` +
    `<p style="font-size:15px;margin:0 0 4px;">New appraisal request from the website. Reply to this email to answer the client directly.</p>` +
    table('Request', rows) + table('Source', sourceRows) + `</div>`;
  const text = 'New appraisal request from the website.\n\nREQUEST\n' +
    rows.map(([k, v]) => `${k}: ${v || '—'}`).join('\n') +
    '\n\nSOURCE\n' + sourceRows.map(([k, v]) => `${k}: ${v}`).join('\n') + '\n';
  return { html, text };
}

async function sendEmail(payload) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Resend ${r.status}: ${data && (data.message || data.name) || 'error'}`);
  return data.id;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return redirect(res, '/contact.html');

  let raw;
  try { raw = await readFields(req); } catch (e) { console.error('contact: body parse failed', e.message); return redirect(res, ERROR_PAGE); }

  // Spam: honeypot filled -> pretend success, send nothing (no ?sent=1, so GA4 does not count a lead).
  if (clean(raw[HONEYPOT], 200)) { console.log('contact: dropped (honeypot)'); return redirect(res, '/thank-you.html'); }

  // Spam: submitted too fast after the page loaded -> pretend success, send nothing.
  const elapsed = Number(clean(raw.form_elapsed_ms, 20));
  const startedAt = Number(clean(raw.form_started_at, 20));
  const fillMs = Number.isFinite(elapsed) && elapsed > 0 ? elapsed : (startedAt > 0 ? Date.now() - startedAt : NaN);
  if (Number.isFinite(fillMs) && fillMs < MIN_FILL_MS) { console.log('contact: dropped (too fast)', fillMs); return redirect(res, '/thank-you.html'); }

  const f = {
    name: oneLine(clean(raw.name, 120)),
    email: oneLine(clean(raw.email, 200)),
    phone: oneLine(clean(raw.phone, 40)),
    address: oneLine(clean(raw.address, 300)),
    purpose: clean(raw.purpose, 60),
    county: clean(raw.county, 60),
    message: clean(raw.message, 5000),
    how_did_you_hear: oneLine(clean(raw.how_did_you_hear, 80)),
  };
  const src = {};
  for (const k of SOURCE_KEYS) src[k] = oneLine(clean(raw[k], 500));

  const emailOk = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[A-Za-z]{2,}$/.test(f.email);
  const phoneOk = (f.phone.match(/\d/g) || []).length >= 7;
  if (!f.name || !emailOk || !phoneOk || !PURPOSES.includes(f.purpose) || !COUNTIES.includes(f.county)) {
    console.log('contact: validation failed', JSON.stringify({ name: !!f.name, emailOk, phoneOk, purpose: PURPOSES.includes(f.purpose), county: COUNTIES.includes(f.county) }));
    return redirect(res, ERROR_PAGE);
  }

  if (!process.env.RESEND_API_KEY) { console.error('contact: RESEND_API_KEY missing'); return redirect(res, ERROR_PAGE); }

  const receivedAt = new Date();
  const inquiry = buildInquiry(f, src, receivedAt);
  const subject = oneLine(`New appraisal request: ${f.name} – ${f.purpose} – ${f.county}`).slice(0, 250);

  try {
    const id = await sendEmail({ from: INTAKE_FROM, to: [INTAKE_TO], reply_to: f.email, subject, html: inquiry.html, text: inquiry.text });
    console.log('contact: inquiry sent', id);
  } catch (e) {
    console.error('contact: inquiry send FAILED', e.message);
    return redirect(res, ERROR_PAGE);
  }

  try {
    const c = buildConfirmation(f);
    const id = await sendEmail({ from: CLIENT_FROM, to: [f.email], reply_to: CLIENT_REPLY_TO, subject: CLIENT_SUBJECT, html: c.html, text: c.text });
    console.log('contact: confirmation sent', id);
  } catch (e) {
    console.error('contact: confirmation send FAILED (inquiry was delivered)', e.message);
  }

  return redirect(res, THANK_YOU);
};

module.exports._test = { renderTemplate, buildConfirmation, buildInquiry, readFields };
