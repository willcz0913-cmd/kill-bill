import { setSubmissionStatus } from '../../../lib/db.js';
import { json, readBody } from '../../../lib/request.js';
import { isAdmin } from '../../../lib/sponsors.js';

// Moderate reader submissions. Gated by the same ADMIN_TOKEN as the sponsor
// admin: a wrong or missing token looks like a page that doesn't exist.
export async function POST({ request }) {
  let body;
  try {
    body = await readBody(request);
  } catch {
    return json({ error: 'bad request' }, 400);
  }

  const token = String(body.token ?? '');
  if (!isAdmin(token)) return json({ error: 'not found' }, 404);

  const action = String(body.action ?? '');
  const id = Number(body.id);
  const backTo = `/admin/submissions?token=${encodeURIComponent(token)}`;
  const back = (msg) =>
    new Response(null, {
      status: 303,
      headers: { Location: `${backTo}&msg=${encodeURIComponent(msg)}` },
    });

  if (!Number.isInteger(id)) return back('bad id');

  // approve = publish to the community section of the app it replaces.
  // unapprove = pull it back to pending (out of public pages, still in queue).
  // remove = hide from the public list (soft, reversible). restore = un-hide.
  if (action === 'approve') {
    await setSubmissionStatus(id, 'approved');
    return back('approved');
  }
  if (action === 'unapprove') {
    await setSubmissionStatus(id, 'pending');
    return back('unapproved');
  }
  if (action === 'remove') {
    await setSubmissionStatus(id, 'rejected');
    return back('removed');
  }
  if (action === 'restore') {
    await setSubmissionStatus(id, 'pending');
    return back('restored');
  }
  return back('unknown action');
}
