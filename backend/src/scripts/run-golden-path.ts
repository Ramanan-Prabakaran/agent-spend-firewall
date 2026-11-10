/**
 * PHASE 3 — Golden Path End-to-End Pipeline Runner
 *
 * Runs the integrated 4-endpoint flow:
 * 1. Propose transaction (via LLM)
 * 2. Evaluate (deterministic firewall policy)
 * 3. Create PayPal Sandbox Order (only if verdict == "allow")
 * 4. Capture PayPal Sandbox Order (after buyer approval)
 *
 * Demonstrates:
 * - Scenario B (Malicious): Blocked by firewall, zero PayPal calls made (403 if attempted).
 * - Scenario A (Legitimate): Approved by firewall, real PayPal Sandbox order created & captured.
 * - Decision Log: Audits both outcomes with plain-English reasons and timestamps.
 */
import path from 'path';
import readline from 'readline';
import dotenv from 'dotenv';
import http from 'http';

dotenv.config({ path: path.join(__dirname, '../../.env') });
dotenv.config({ path: path.join(__dirname, '../../../.env') });

import app from '../index';
import { initDb } from '../db/database';
import { SCENARIO_A, SCENARIO_B } from '../lib/scenarios';

interface ProposeResponse {
  proposal: {
    itemName: string;
    qty: number;
    unitPriceUsd: number;
    totalUsd: number;
    shippingAddress?: string;
  };
  injectionScore: number;
  injectionDetails: string[];
}

interface EvaluateResponse {
  verdict: 'allow' | 'block';
  reasons: string[];
  logId: number;
}

interface CreateOrderResponse {
  orderId: string;
  approvalUrl: string;
  serverTotal: string;
  status: string;
  error?: string;
}

interface CaptureOrderResponse {
  orderId: string;
  captureId: string;
  orderStatus: string;
  captureStatus: string;
  amount?: {
    value: string;
    currencyCode: string;
  };
}

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function startServer(): Promise<{ server: http.Server; baseUrl: string }> {
  await initDb();
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const addr = server.address() as { port: number };
      const baseUrl = `http://localhost:${addr.port}`;
      resolve({ server, baseUrl });
    });
  });
}

async function waitForApproved(
  baseUrl: string,
  orderId: string,
  timeoutMs = 180_000,
  pollIntervalMs = 3_000
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let attempts = 0;

  while (Date.now() < deadline) {
    attempts++;
    const res = await fetch(`${baseUrl}/api/paypal/order/${orderId}`);
    const order = (await res.json()) as { status?: string };
    const status = order.status ?? 'UNKNOWN';

    console.log(`   [Attempt ${attempts}] GET /api/paypal/order/${orderId} → HTTP ${res.status} | status: ${status}`);

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
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║        AI AGENT SPEND FIREWALL — GOLDEN PATH PIPELINE        ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  console.log('Starting ephemeral backend server for test run...');
  const { server, baseUrl } = await startServer();
  console.log(`✓ Backend running at: ${baseUrl}\n`);

  try {
    // ═══════════════════════════════════════════════════════════════
    // PART 1: SCENARIO B — MALICIOUS LISTING (PROMPT INJECTION)
    // ═══════════════════════════════════════════════════════════════
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║  PART 1: SCENARIO B (MALICIOUS PROMPT-INJECTION PAYLOAD)    ║');
    console.log('╚══════════════════════════════════════════════════════════════╝\n');
    console.log(`Target item   : ${SCENARIO_B.requestedItem} (qty: ${SCENARIO_B.requestedQty}, $${SCENARIO_B.requestedPrice})`);
    console.log(`Source text   :\n${SCENARIO_B.sourceText}\n`);

    // Step 1: Propose transaction
    console.log('1. Calling POST /api/agent/propose-transaction ...');
    const propResB = await fetch(`${baseUrl}/api/agent/propose-transaction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceText: SCENARIO_B.sourceText,
        requestedItem: SCENARIO_B.requestedItem,
        requestedQty: SCENARIO_B.requestedQty,
        requestedPrice: SCENARIO_B.requestedPrice,
      }),
    });

    const propDataB = (await propResB.json()) as ProposeResponse;
    console.log('   ✓ LLM Extracted Proposal:');
    console.log(`     - Item             : ${propDataB.proposal?.itemName}`);
    console.log(`     - Quantity         : ${propDataB.proposal?.qty}`);
    console.log(`     - Unit Price       : $${propDataB.proposal?.unitPriceUsd}`);
    console.log(`     - Total            : $${propDataB.proposal?.totalUsd}`);
    console.log(`     - Injection Score  : ${propDataB.injectionScore} (threshold is 0.60)`);
    console.log(`     - Injection Flags  : ${JSON.stringify(propDataB.injectionDetails)}`);

    // Step 2: Firewall Evaluation
    console.log('\n2. Calling POST /api/firewall/evaluate ...');
    const evalResB = await fetch(`${baseUrl}/api/firewall/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        proposal: propDataB.proposal,
        injectionScore: propDataB.injectionScore,
        injectionDetails: propDataB.injectionDetails,
        requestedQty: SCENARIO_B.requestedQty,
        requestedPrice: SCENARIO_B.requestedPrice,
        sourceText: SCENARIO_B.sourceText,
      }),
    });

    const evalDataB = (await evalResB.json()) as EvaluateResponse;
    console.log(`   ✓ Verdict : [ ${evalDataB.verdict.toUpperCase()} ]`);
    console.log(`   ✓ Log ID  : ${evalDataB.logId}`);
    console.log('   ✓ Reasons :');
    evalDataB.reasons.forEach((r: string) => console.log(`       • ${r}`));

    if (evalDataB.verdict !== 'block') {
      throw new Error(`Expected Scenario B to be blocked, but got: ${evalDataB.verdict}`);
    }

    // Step 3: Prove create-order refuses to call PayPal for blocked proposals
    console.log('\n3. Testing Firewall Gating: Attempting POST /api/paypal/create-order for blocked logId ...');
    const blockedOrderRes = await fetch(`${baseUrl}/api/paypal/create-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ logId: evalDataB.logId }),
    });

    const blockedOrderData = await blockedOrderRes.json();
    console.log(`   ✓ HTTP Status : ${blockedOrderRes.status} (Expected: 403 Forbidden)`);
    console.log(`   ✓ Error Body  : ${JSON.stringify(blockedOrderData)}`);

    if (blockedOrderRes.status !== 403) {
      throw new Error(`Expected HTTP 403 from create-order on blocked transaction, got ${blockedOrderRes.status}`);
    }
    console.log('\n   ✅ ASSERTION PASSED: PayPal create-order is strictly blocked server-side.');
    console.log('      Zero PayPal Sandbox calls were fired for Scenario B.\n');

    // ═══════════════════════════════════════════════════════════════
    // PART 2: SCENARIO A — LEGITIMATE PURCHASE FLOW
    // ═══════════════════════════════════════════════════════════════
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║  PART 2: SCENARIO A (LEGITIMATE PURCHASE FLOW)               ║');
    console.log('╚══════════════════════════════════════════════════════════════╝\n');
    console.log(`Target item   : ${SCENARIO_A.requestedItem} (qty: ${SCENARIO_A.requestedQty}, $${SCENARIO_A.requestedPrice})`);
    console.log(`Source text   :\n${SCENARIO_A.sourceText}\n`);

    // Step 1: Propose transaction
    console.log('1. Calling POST /api/agent/propose-transaction ...');
    const propResA = await fetch(`${baseUrl}/api/agent/propose-transaction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceText: SCENARIO_A.sourceText,
        requestedItem: SCENARIO_A.requestedItem,
        requestedQty: SCENARIO_A.requestedQty,
        requestedPrice: SCENARIO_A.requestedPrice,
      }),
    });

    const propDataA = (await propResA.json()) as ProposeResponse;
    console.log('   ✓ LLM Extracted Proposal:');
    console.log(`     - Item             : ${propDataA.proposal?.itemName}`);
    console.log(`     - Quantity         : ${propDataA.proposal?.qty}`);
    console.log(`     - Unit Price       : $${propDataA.proposal?.unitPriceUsd}`);
    console.log(`     - Total            : $${propDataA.proposal?.totalUsd}`);
    console.log(`     - Injection Score  : ${propDataA.injectionScore} (threshold is 0.60)`);
    console.log(`     - Injection Flags  : ${JSON.stringify(propDataA.injectionDetails)}`);

    // Step 2: Firewall Evaluation
    console.log('\n2. Calling POST /api/firewall/evaluate ...');
    const evalResA = await fetch(`${baseUrl}/api/firewall/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        proposal: propDataA.proposal,
        injectionScore: propDataA.injectionScore,
        injectionDetails: propDataA.injectionDetails,
        requestedQty: SCENARIO_A.requestedQty,
        requestedPrice: SCENARIO_A.requestedPrice,
        sourceText: SCENARIO_A.sourceText,
      }),
    });

    const evalDataA = (await evalResA.json()) as EvaluateResponse;
    console.log(`   ✓ Verdict : [ ${evalDataA.verdict.toUpperCase()} ]`);
    console.log(`   ✓ Log ID  : ${evalDataA.logId}`);
    console.log('   ✓ Reasons :');
    evalDataA.reasons.forEach((r: string) => console.log(`       • ${r}`));

    if (evalDataA.verdict !== 'allow') {
      throw new Error(`Expected Scenario A to be allowed, but got: ${evalDataA.verdict}`);
    }

    // Step 3: Create PayPal Order
    console.log('\n3. Firewall Approved: Calling POST /api/paypal/create-order ...');
    const orderResA = await fetch(`${baseUrl}/api/paypal/create-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ logId: evalDataA.logId }),
    });

    const orderDataA = (await orderResA.json()) as CreateOrderResponse;
    console.log(`   ✓ HTTP Status    : ${orderResA.status}`);
    console.log(`   ✓ PayPal Order ID: ${orderDataA.orderId}`);
    console.log(`   ✓ Server Amount  : $${orderDataA.serverTotal} USD (recomputed independently)`);
    console.log(`   ✓ Approval URL   : ${orderDataA.approvalUrl}\n`);

    if (!orderDataA.approvalUrl) {
      throw new Error('No approvalUrl returned from PayPal create-order.');
    }

    // Step 4: Buyer Approval Prompt
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║          ACTION REQUIRED: BUYER SANDBOX APPROVAL             ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log('\n  Open this fresh approval URL in your browser:\n');
    console.log(`  ➜  ${orderDataA.approvalUrl}\n`);
    console.log('  Instructions:');
    console.log('  1. Use your US Personal (Buyer) sandbox account credentials.');
    console.log('  2. Click "Agree & Pay Now" on the PayPal approval page.');
    console.log('  3. The browser will redirect to localhost:5173 (showing 404 — that is expected).');
    console.log('  4. Once redirected, come back here and press Enter.\n');

    await prompt('  Press Enter after completing PayPal approval in the browser... ');

    // Step 5: Verify Order Status
    console.log(`\n4. Verifying order status for ${orderDataA.orderId} ...`);
    const finalOrderStatus = await waitForApproved(baseUrl, orderDataA.orderId);
    console.log(`   ✓ Confirmed Order Status: ${finalOrderStatus} — Ready to capture.\n`);

    // Step 6: Capture Order
    console.log('5. Calling POST /api/paypal/capture-order ...');
    const captureResA = await fetch(`${baseUrl}/api/paypal/capture-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId: orderDataA.orderId,
        logId: evalDataA.logId,
      }),
    });

    const captureDataA = (await captureResA.json()) as CaptureOrderResponse;
    console.log(`   ✓ HTTP Status     : ${captureResA.status}`);
    console.log(`   ✓ Capture ID      : ${captureDataA.captureId}`);
    console.log(`   ✓ Capture Status  : ${captureDataA.captureStatus}`);
    console.log(`   ✓ Captured Amount : $${captureDataA.amount?.value} ${captureDataA.amount?.currencyCode}`);

    // ═══════════════════════════════════════════════════════════════
    // PART 3: DECISION LOG AUDIT
    // ═══════════════════════════════════════════════════════════════
    console.log('\n╔══════════════════════════════════════════════════════════════╗');
    console.log('║  PART 3: FIREWALL DECISION LOG AUDIT TABLE                   ║');
    console.log('╚══════════════════════════════════════════════════════════════╝\n');

    const logRes = await fetch(`${baseUrl}/api/firewall/decision-log`);
    const logEntries = (await logRes.json()) as Array<{
      id: number;
      created_at: string;
      item_name: string;
      qty: number;
      unit_price: number;
      total_usd: number;
      verdict: string;
      reasons: string[];
      injection_score: number;
      paypal_order_id: string | null;
      paypal_capture_id: string | null;
    }>;

    console.table(
      logEntries.map((e) => ({
        ID: e.id,
        Item: e.item_name,
        Qty: e.qty,
        'Total USD': `$${e.total_usd.toFixed(2)}`,
        Verdict: e.verdict.toUpperCase(),
        'Inj Score': e.injection_score != null ? e.injection_score.toFixed(2) : 'N/A',
        'PayPal Order': e.paypal_order_id ?? 'NONE (BLOCKED)',
        'PayPal Capture': e.paypal_capture_id ?? 'NONE',
        Timestamp: e.created_at,
      }))
    );

    console.log('\nDetailed Reasons Log:');
    logEntries.forEach((e) => {
      console.log(`\n[Log #${e.id}] ${e.item_name} → ${e.verdict.toUpperCase()}`);
      e.reasons.forEach((r) => console.log(`   • ${r}`));
    });

    console.log('\n╔══════════════════════════════════════════════════════════════╗');
    console.log('║      PHASE 3 GOLDEN PATH PIPELINE COMPLETED SUCCESSFULLY      ║');
    console.log('╚══════════════════════════════════════════════════════════════╝\n');
  } finally {
    server.close();
  }
}

main().catch((err) => {
  console.error('\n✗ Golden Path failed:', err);
  process.exit(1);
});
