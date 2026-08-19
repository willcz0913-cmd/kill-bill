import { addAppSubmission, rateLimit } from '../../lib/db.js';
import { CATEGORIES, allApps } from '../../lib/apps.js';
import { clientIp, readBody, validEmail } from '../../lib/request.js';

// Map the free-text "what does it replace" onto a real death-list slug so the
// submission can render on that app's alternatives page. Matches the slug, the
// full name, or the base name before " / " (case-insensitive). No match means
// the paid app isn't on the list yet: stored as null, kept in the queue.
function resolveReplacesSlug(raw) {
  const q = raw?.trim().toLowerCase();
  if (!q) return null;
  for (const a of allApps()) {
    if (a.slug === q) return a.slug;
    if (a.name.toLowerCase() === q) return a.slug;
    if (a.name.split(' / ')[0].toLowerCase() === q) return a.slug;
  }
  return null;
}

// Send the visitor back to the form with a status flag. A 303 keeps this a
// plain form post: it works with JS off, and refreshing the landing page can't
// resubmit. The #form hash drops them back at the banner, not the page top.
function back(request, params) {
  const url = new URL('/submit-an-app', request.url);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new Response(null, {
    status: 303,
    headers: { Location: `${url.pathname}${url.search}#form` },
  });
}

// Only ever store an http(s) link. Bare domains get https:// prepended so
// "acme.com" works; anything without a dotted host, or a javascript:/data:
// scheme, is rejected so the public list can never render a hostile href.
function cleanUrl(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!u.hostname.includes('.')) return null;
    return u.href;
  } catch {
    return null;
  }
}

export async function POST({ request, locals, clientAddress }) {
  // Signed-in accounts only. The page hides the form when logged out; this is
  // the enforcement behind it, so a hand-rolled POST can't slip past.
  if (!locals.user) return back(request, { error: 'auth' });

  const ip = clientIp(request, clientAddress);
  if (!(await rateLimit(`submit:${ip}`, 5, 60 * 60 * 1000))) {
    return back(request, { error: 'slow' });
  }

  let body;
  try {
    body = await readBody(request);
  } catch {
    return back(request, { error: 'bad' });
  }

  // Honeypot: bots fill every field. Pretend success, store nothing.
  if (body.website) return back(request, { sent: '1' });

  const name = body.name?.trim().slice(0, 80);
  const url = cleanUrl(body.url);
  const alternativeTo = body.alternativeTo?.trim().slice(0, 80) || null;
  const category = CATEGORIES[body.category] ? body.category : null;
  const pitch = body.pitch?.trim().slice(0, 240) || null;
  const email = body.email?.trim().toLowerCase();
  const emailClean = email && validEmail(email) ? email : null;
  const replacesSlug = resolveReplacesSlug(alternativeTo);

  if (!name || !url) return back(request, { error: 'missing' });
  // Category is required: it's how a submission is filed, and the community
  // section can't place a homeless entry.
  if (!category) return back(request, { error: 'nocat' });

  await addAppSubmission({ name, url, alternativeTo, replacesSlug, category, pitch, email: emailClean });
  return back(request, { sent: '1' });
}
