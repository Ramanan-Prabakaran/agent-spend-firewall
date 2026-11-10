import path from 'path';
import dotenv from 'dotenv';
import http from 'http';

dotenv.config({ path: path.join(__dirname, '../../../backend/.env') });
dotenv.config({ path: path.join(__dirname, '../../../../.env') });

import app from '../index';
import { initDb } from '../db/database';
import { SCENARIO_A, SCENARIO_B } from '../lib/scenarios';

describe('Phase 3 Golden Path End-to-End Endpoint Wiring', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    await initDb();
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address() as { port: number };
        baseUrl = `http://localhost:${addr.port}`;
        resolve();
      });
    });
  });

  afterAll((done) => {
    server.close(done);
  });

  // Give external API calls up to 30s
  jest.setTimeout(35000);

  test('1. GET /api/agent/scenarios returns both seed scenarios', async () => {
    const res = await fetch(`${baseUrl}/api/agent/scenarios`);
    expect(res.status).toBe(200);
    const scenarios = (await res.json()) as Array<{ id: string }>;
    expect(scenarios.length).toBe(2);
    expect(scenarios.map((s) => s.id)).toEqual(['scenario-a', 'scenario-b']);
  });

  test('2. Scenario B (Malicious): Propose → Evaluate (BLOCK) → create-order strictly blocked with 403', async () => {
    // Step 1: Propose transaction
    const propRes = await fetch(`${baseUrl}/api/agent/propose-transaction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceText: SCENARIO_B.sourceText,
        requestedItem: SCENARIO_B.requestedItem,
        requestedQty: SCENARIO_B.requestedQty,
        requestedPrice: SCENARIO_B.requestedPrice,
      }),
    });
    expect(propRes.status).toBe(200);
    const propData = (await propRes.json()) as any;
    expect(propData.injectionScore).toBeGreaterThanOrEqual(0.6);

    // Step 2: Evaluate
    const evalRes = await fetch(`${baseUrl}/api/firewall/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        proposal: propData.proposal,
        injectionScore: propData.injectionScore,
        injectionDetails: propData.injectionDetails,
        requestedQty: SCENARIO_B.requestedQty,
        requestedPrice: SCENARIO_B.requestedPrice,
        sourceText: SCENARIO_B.sourceText,
      }),
    });
    expect(evalRes.status).toBe(200);
    const evalData = (await evalRes.json()) as any;
    expect(evalData.verdict).toBe('block');
    expect(evalData.logId).toBeDefined();

    // Step 3: Attempt create-order on blocked transaction → MUST be 403
    const orderRes = await fetch(`${baseUrl}/api/paypal/create-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ logId: evalData.logId }),
    });
    expect(orderRes.status).toBe(403);
    const orderData = (await orderRes.json()) as any;
    expect(orderData.error).toContain('Firewall verdict is not "allow"');
    // Proof: Zero PayPal API call was allowed to initiate an order for Scenario B
  });

  test('3. Scenario A (Legitimate): Propose → Evaluate (ALLOW) → create-order generates real Sandbox order', async () => {
    // Step 1: Propose transaction
    const propRes = await fetch(`${baseUrl}/api/agent/propose-transaction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceText: SCENARIO_A.sourceText,
        requestedItem: SCENARIO_A.requestedItem,
        requestedQty: SCENARIO_A.requestedQty,
        requestedPrice: SCENARIO_A.requestedPrice,
      }),
    });
    expect(propRes.status).toBe(200);
    const propData = (await propRes.json()) as any;
    expect(propData.injectionScore).toBeLessThan(0.4);

    // Step 2: Evaluate
    const evalRes = await fetch(`${baseUrl}/api/firewall/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        proposal: propData.proposal,
        injectionScore: propData.injectionScore,
        injectionDetails: propData.injectionDetails,
        requestedQty: SCENARIO_A.requestedQty,
        requestedPrice: SCENARIO_A.requestedPrice,
        sourceText: SCENARIO_A.sourceText,
      }),
    });
    expect(evalRes.status).toBe(200);
    const evalData = (await evalRes.json()) as any;
    expect(evalData.verdict).toBe('allow');
    expect(evalData.logId).toBeDefined();

    // Step 3: Create real PayPal Sandbox order
    const orderRes = await fetch(`${baseUrl}/api/paypal/create-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ logId: evalData.logId }),
    });
    expect(orderRes.status).toBe(201);
    const orderData = (await orderRes.json()) as any;
    expect(orderData.orderId).toBeDefined();
    expect(orderData.approvalUrl).toContain('https://www.sandbox.paypal.com');
    expect(orderData.serverTotal).toBe('89.99');
  });
});

