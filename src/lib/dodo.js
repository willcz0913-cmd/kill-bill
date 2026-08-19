/* Dodo Payments over plain fetch. A deliberate drop-in for the old stripe.js:
   the exported names and shapes match what the sponsor flow already calls, so
   checkout.js, webhook.js, admin.js and the details page barely change.

   The one adapter trick: the webhook and the payment lookups return a small
   session-shaped object (id / payment_status / payment_intent / metadata /
   customer_details / amount_total) so promoteFromSession + reconcileLinkSession
   keep working verbatim against it. Dodo speaks JSON, not Stripe's form encoding.

   Dodo is a Merchant of Record, so tax and invoicing are Dodo's job — none of
   Stripe's tax_id / invoice_creation plumbing carries over. */

import crypto from 'node:crypto';

const MODE = process.env.DODO_MODE === 'live' ? 'live' : 'test';
// Test base is documented; live base is confirmed at go-live. Both take the same
// Bearer key (test vs live keys are minted separately in the dashboard).
const API = MODE === 'live' ? 'https://live.dodopayments.com' : 'https://test.dodopayments.com';
const SIGNATURE_TOLERANCE_S = 300;

function productId() {
  const id = process.env.DODO_PRODUCT_ID;
  if (!id) throw new Error('missing DODO_PRODUCT_ID');
  return id;
}

async function dodoFetch(pathname, { method = 'POST', body, idempotencyKey } = {}) {
  const key = process.env.DODO_PAYMENTS_API_KEY;
  if (!key) throw new Error('missing DODO_PAYMENTS_API_KEY');
  const res = await fetch(`${API}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      // Dodo honors Idempotency-Key; a retry after a lost response replays the
      // original result instead of acting twice.
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`dodo ${pathname}: HTTP ${res.status} ${json?.message || ''}`.trim());
  }
  return json;
}

/* A Dodo Payment (from the API or a webhook's data object) reshaped into the
   session-ish object the rest of the sponsor code already understands. */
export function normalizePayment(p) {
  if (!p) return null;
  return {
    id: p.payment_id,
    // The whole promotion path keys off 'paid'; every other status is passed
    // through so a not-yet-terminal payment is treated as not-paid.
    payment_status: p.status === 'succeeded' ? 'paid' : p.status,
    payment_intent: p.payment_id, // Dodo refunds key on the payment id itself.
    client_reference_id: p.metadata?.purchase_id ?? null,
    metadata: p.metadata ?? {},
    customer_details: { email: p.customer?.email ?? null },
    amount_total: p.total_amount ?? null,
  };
}

/* Self-serve checkout for one slot. The slot's price is passed as `amount`
   (cents) against the single pay-what-you-want product, which is how variable
   per-slot pricing survives Dodo's product-centric model. Dodo's hosted page
   collects the buyer's email + tax details, so no customer is sent here. */
export async function createCheckoutSession({ purchaseId, slotId, priceCents, successUrl, months = 1 }) {
  const res = await dodoFetch('/checkouts', {
    body: {
      product_cart: [{ product_id: productId(), quantity: 1, amount: priceCents }],
      return_url: successUrl,
      metadata: { purchase_id: purchaseId, slot_id: slotId, months: Number(months) || 1 },
    },
  });
  return { id: res.session_id, url: res.checkout_url };
}

/* Hand-issued shareable link for a slot's next run (renewals / negotiated
   deals). Carries the same LINK_PURPOSE metadata the webhook reconciles into a
   purchase row. Uses the dynamic payment-link API so it shares the configured
   API base rather than a separate checkout host.
   NOTE: verify the customer requirement against a live test — if Dodo rejects a
   link without a customer, we'll collect it on the hosted page instead. */
export async function createPaymentLink({ name, priceCents, metadata }) {
  const res = await dodoFetch('/payments', {
    body: {
      payment_link: true,
      product_cart: [{ product_id: productId(), quantity: 1, amount: priceCents }],
      metadata,
    },
  });
  // `name` is retained for parity with the old signature / log lines.
  void name;
  return { url: res.payment_link };
}

export async function getPayment(paymentId) {
  const p = await dodoFetch(`/payments/${encodeURIComponent(paymentId)}`, { method: 'GET' });
  return normalizePayment(p);
}

export async function createRefund(paymentId, idempotencyKey) {
  // Omitting `items` refunds the payment in full.
  return dodoFetch('/refunds', { body: { payment_id: paymentId }, idempotencyKey });
}

export async function listRefunds(paymentId) {
  return dodoFetch(`/refunds?payment_id=${encodeURIComponent(paymentId)}`, { method: 'GET' });
}

/* A refund already on its way back (settled or still moving) means a second one
   must not be created. Failed refunds don't count — those are the retryable
   ones. Dodo refund statuses: succeeded | failed | pending | review. */
export async function alreadyRefunded(paymentId) {
  const list = await listRefunds(paymentId);
  const items = list?.items ?? list?.data ?? [];
  return items.some((r) => ['succeeded', 'pending', 'review'].includes(r.status));
}

/* Standard Webhooks verification (the scheme Dodo uses): HMAC-SHA256 over
   `${id}.${timestamp}.${rawBody}`, keyed by the base64 secret behind the
   `whsec_` prefix, base64-compared against the space-delimited `v1,<sig>` list
   in webhook-signature. The raw bytes must be the exact ones Dodo sent. */
export function verifyWebhook(rawBody, { id, timestamp, signature } = {}, secret) {
  if (!rawBody || !id || !timestamp || !signature || !secret) return false;
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(age) || age > SIGNATURE_TOLERANCE_S) return false;

  const keyB64 = secret.startsWith('whsec_') ? secret.slice(6) : secret;
  const key = Buffer.from(keyB64, 'base64');
  const expected = crypto
    .createHmac('sha256', key)
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest('base64');

  return String(signature)
    .split(' ')
    .some((part) => {
      const sig = part.includes(',') ? part.split(',')[1] : part;
      return (
        sig &&
        sig.length === expected.length &&
        crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
      );
    });
}
