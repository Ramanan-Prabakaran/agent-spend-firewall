/**
 * PHASE 1 — PayPal Sandbox proof of life
 * Uses the official @paypal/paypal-server-sdk (not hand-rolled OAuth/fetch).
 *
 * Run: npm run proof
 *
 * What this proves end-to-end:
 *   1. OAuth2 client-credentials exchange (SDK handles it automatically on first call)
 *   2. A real Sandbox order is created → real PayPal order ID returned
 *   3. Buyer-approval URL printed → YOU open it in a browser and approve
 *      (logs in as your Sandbox Personal/Buyer account at www.sandbox.paypal.com)
 *   4. Script polls GET /v2/checkout/orders/:id and waits until status = APPROVED
 *   5. Only then calls captureOrder → real capture ID printed
 *
 * The approval step is a REAL browser interaction — it cannot be mocked.
 */
import path from 'path';
import readline from 'readline';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '../../.env') });
dotenv.config({ path: path.join(__dirname, '../../../.env') });

import {
  Client,
  Environment,
  OrdersController,
  CheckoutPaymentIntent,
  OrderApplicationContextUserAction,
  ItemCategory,
  ApiError,
} from '@paypal/paypal-server-sdk';

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => { rl.close(); resolve(answer); });
  });
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

interface LinkDescription { href: string; rel: string }

/**
 * Poll getOrder until status is APPROVED or we time out.
 * Returns the final status string.
 */
async function waitForApproved(
  controller: OrdersController,
  orderId: string,
  timeoutMs = 180_000,
  pollIntervalMs = 3_000
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let attempts = 0;

  while (Date.now() < deadline) {
    attempts++;
    // Fresh GET call to PayPal Orders API on every iteration
    const response = await controller.getOrder({ id: orderId });
    const { statusCode, result } = response;
    const status = result?.status ?? 'UNKNOWN';

    console.log(`─────────────────────────────────────────────────────────────`);
    console.log(`[Attempt ${attempts}] GET /v2/checkout/orders/${orderId}`);
    console.log(`  HTTP Status Code      : ${statusCode}`);
    console.log(`  Order Business Status : ${status}`);
    console.log(`  Full Raw JSON Response:`);
    console.log(JSON.stringify(result, null, 2));
    console.log(`─────────────────────────────────────────────────────────────`);

    if (status === 'APPROVED' || status === 'COMPLETED') {
      return status;
    }

    if (status === 'VOIDED' || status === 'SAVED') {
      throw new Error(`Order cannot be captured — status is ${status}.`);
    }

    await sleep(pollIntervalMs);
  }

  throw new Error(`Timed out after ${timeoutMs / 1000}s waiting for APPROVED status.`);
}

async function main() {
  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║   PayPal Sandbox — Phase 1 Proof of Life     ║');
  console.log('╚══════════════════════════════════════════════╝\n');

  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error('✗ Missing PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET\n');
    console.error('  Create backend/.env from .env.example and fill in your Sandbox credentials.');
    console.error('  Get them from: developer.paypal.com → Apps & Credentials → Sandbox tab');
    process.exit(1);
  }

  // ── 1. Build SDK client ─────────────────────────────────────────────────
  console.log('1. Initialising @paypal/paypal-server-sdk (Sandbox environment)...');
  const client = new Client({
    clientCredentialsAuthCredentials: {
      oAuthClientId: clientId,
      oAuthClientSecret: clientSecret,
    },
    environment: Environment.Sandbox,
  });
  const ordersController = new OrdersController(client);
  console.log('   ✓ Client ready\n');

  // ── 2. Create order ─────────────────────────────────────────────────────
  console.log('2. Creating Sandbox order ($1.00 test item)...');

  // NOTE on returnUrl: localhost:5173 will 404 since there is no frontend yet.
  // That is fine — PayPal marks the order APPROVED on its own servers BEFORE
  // issuing the redirect. The 404 does NOT cancel the approval. We confirm
  // approval status via the polling GET call below, not via the redirect.
  const { result: order, statusCode: createStatusCode } = await ordersController.createOrder({
    body: {
      intent: CheckoutPaymentIntent.Capture,
      purchaseUnits: [
        {
          description: 'AI Spend Firewall — Phase 1 test',
          amount: {
            currencyCode: 'USD',
            value: '1.00',
            breakdown: { itemTotal: { currencyCode: 'USD', value: '1.00' } },
          },
          items: [
            {
              name: 'Test Widget',
              quantity: '1',
              unitAmount: { currencyCode: 'USD', value: '1.00' },
              category: ItemCategory.PhysicalGoods,
            },
          ],
        },
      ],
      applicationContext: {
        brandName: 'AI Agent Spend Firewall',
        userAction: OrderApplicationContextUserAction.PayNow,
        // returnUrl/cancelUrl are required by PayPal, but the 404 on localhost
        // does not affect order status — approval is registered server-side first.
        returnUrl: 'http://localhost:5173/result?approved=true',
        cancelUrl:  'http://localhost:5173/result?approved=false',
      },
    },
    prefer: 'return=representation',
  });

  console.log(`   ✓ HTTP status : ${createStatusCode}`);
  console.log(`   ✓ Order ID    : ${order.id}`);
  console.log(`   ✓ Order status: ${order.status}`);

  const links = (order.links ?? []) as LinkDescription[];
  const approvalUrl = links.find(
    (l) => l.rel === 'approve' || l.rel === 'payer-action'
  )?.href;

  if (!approvalUrl) {
    console.error('\n✗ No approval URL returned. Full links array:');
    console.error(JSON.stringify(links, null, 2));
    process.exit(1);
  }

  // ── 3. Human approval step ──────────────────────────────────────────────
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║               BUYER APPROVAL REQUIRED NOW                   ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  console.log(`\n  Order ID being approved: ${order.id}`);
  console.log('  (Confirm this matches the token= parameter in the URL below)\n');

  console.log('  ⚠  SINGLE-USE LINK — this URL is tied to THIS run only.');
  console.log('     Do NOT use a URL copied from a previous run. It will not work.\n');

  console.log('  Open this FRESH URL in your browser now:\n');
  console.log(`  ➜  ${approvalUrl}\n`);

  console.log('  ─────────────────────────────────────────────────────────────');
  console.log('  IMPORTANT — which account to log in with:');
  console.log('    ✓ Use your SANDBOX PERSONAL (Buyer) account');
  console.log('      Found at: developer.paypal.com → Testing Tools → Sandbox Accounts');
  console.log('      It looks like: sb-XXXXX@personal.example.com');
  console.log('    ✗ NOT your real PayPal account (that is only for the Developer Dashboard)');
  console.log('    ✗ NOT the Sandbox Business/Seller account');
  console.log('  ─────────────────────────────────────────────────────────────\n');

  console.log('  Steps:');
  console.log('  ① Open the URL above in a fresh browser tab (clear cookies or use incognito)');
  console.log('  ② Log in with the Sandbox Personal (Buyer) account');
  console.log('  ③ Click "Agree & Pay Now" — do NOT close the tab until you see the redirect');
  console.log('  ④ The browser will redirect to localhost:5173 and show a 404 — THAT IS FINE');
  console.log('     PayPal marks the order APPROVED on its servers before firing the redirect.');
  console.log('  ⑤ Once you see the 404 page, come back here and press Enter\n');

  await prompt('  Press Enter after you see the 404 redirect from "Agree & Pay Now"... ');

  // ── 4. Verify APPROVED status before capture ────────────────────────────
  console.log(`\n3. Polling GET /v2/checkout/orders/${order.id} until status = APPROVED...`);
  console.log(`   Order ID: ${order.id}`);
  console.log('   (Will poll every 3s, up to 180s)\n');
  const approvedStatus = await waitForApproved(ordersController, order.id!, 180_000, 3_000);
  console.log(`   ✓ Order status confirmed: ${approvedStatus} — safe to capture\n`);

  // ── 5. Capture ──────────────────────────────────────────────────────────
  console.log('4. Capturing order...');
  const { result: capture, statusCode: captureStatusCode } = await ordersController.captureOrder({
    id: order.id!,
    prefer: 'return=representation',
  });

  const captureRecord = capture.purchaseUnits?.[0]?.payments?.captures?.[0];

  console.log(`   ✓ HTTP status    : ${captureStatusCode}`);
  console.log(`   ✓ Order status   : ${capture.status}`);
  console.log(`   ✓ Capture ID     : ${captureRecord?.id}`);
  console.log(`   ✓ Capture status : ${captureRecord?.status}`);
  console.log(
    `   ✓ Amount         : ${captureRecord?.amount?.value} ${captureRecord?.amount?.currencyCode}`
  );

  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║   END-TO-END PayPal Sandbox  ✓  SUCCESS      ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('\nFull result:');
  console.log(JSON.stringify({
    orderId: order.id,
    captureId: captureRecord?.id,
    captureStatus: captureRecord?.status,
    amount: captureRecord?.amount,
  }, null, 2));

  process.exit(0);
}

main().catch((err) => {
  if (err instanceof ApiError) {
    console.error(`\n✗ PayPal ApiError (HTTP ${err.statusCode}):`);
    console.error(JSON.stringify(err.body, null, 2));
  } else {
    console.error('\n✗ FAILED:', err.message);
  }
  process.exit(1);
});
