import path from 'path';
import dotenv from 'dotenv';
import http from 'http';

dotenv.config({ path: path.join(__dirname, '../../../backend/.env') });
dotenv.config({ path: path.join(__dirname, '../../../../.env') });

// Mock PayPal SDK / controller before importing routes
const mockCreateOrder = jest.fn();
const mockCaptureOrder = jest.fn();

jest.mock('../lib/paypal', () => {
  const actual = jest.requireActual('../lib/paypal');
  return {
    ...actual,
    getOrdersController: jest.fn(() => ({
      createOrder: mockCreateOrder,
      captureOrder: mockCaptureOrder,
      getOrder: jest.fn(),
    })),
  };
});

import app from '../index';
import { getDb, initDb, persistDb } from '../db/database';
import { SCENARIO_B } from '../lib/scenarios';

describe('Phase 3 Addendum: Capture Guards & Mocked SDK Call-Count Assertions', () => {
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

  beforeEach(() => {
    mockCreateOrder.mockClear();
    mockCaptureOrder.mockClear();
  });

  test('1. POST /api/paypal/capture-order rejects unknown logId with 404', async () => {
    const res = await fetch(`${baseUrl}/api/paypal/capture-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: 'FAKE_ORDER_123', logId: 999999 }),
    });
    expect(res.status).toBe(404);
    const data = (await res.json()) as any;
    expect(data.error).toContain('No decision log entry with id=999999');
    expect(mockCaptureOrder).toHaveBeenCalledTimes(0);
  });

  test('2. POST /api/paypal/capture-order rejects verdict=block with 403', async () => {
    const db = await getDb();
    db.run(
      `INSERT INTO decision_log (item_name, qty, unit_price, total_usd, verdict, reasons, injection_score)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['Blocked Item', 1, 10.0, 10.0, 'block', JSON.stringify(['injection detected']), 0.9]
    );
    const idRes = db.exec('SELECT last_insert_rowid() as id');
    const blockedLogId = idRes[0]?.values[0]?.[0] as number;
    persistDb(db);

    const res = await fetch(`${baseUrl}/api/paypal/capture-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: 'FAKE_ORDER_BLOCK', logId: blockedLogId }),
    });
    expect(res.status).toBe(403);
    const data = (await res.json()) as any;
    expect(data.error).toContain('Firewall verdict is not "allow"');
    expect(mockCaptureOrder).toHaveBeenCalledTimes(0);
  });

  test('3. POST /api/paypal/capture-order rejects when order not created with 400', async () => {
    const db = await getDb();
    db.run(
      `INSERT INTO decision_log (item_name, qty, unit_price, total_usd, verdict, reasons, injection_score)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['Allowed Item No Order', 1, 10.0, 10.0, 'allow', JSON.stringify(['all checks passed']), 0.0]
    );
    const idRes = db.exec('SELECT last_insert_rowid() as id');
    const noOrderLogId = idRes[0]?.values[0]?.[0] as number;
    persistDb(db);

    const res = await fetch(`${baseUrl}/api/paypal/capture-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: 'ORDER_DOES_NOT_EXIST', logId: noOrderLogId }),
    });
    expect(res.status).toBe(400);
    const data = (await res.json()) as any;
    expect(data.error).toContain('PayPal order has not been created');
    expect(mockCaptureOrder).toHaveBeenCalledTimes(0);
  });

  test('4. POST /api/paypal/capture-order rejects already captured order with 409 Conflict', async () => {
    const db = await getDb();
    db.run(
      `INSERT INTO decision_log (item_name, qty, unit_price, total_usd, verdict, reasons, injection_score, paypal_order_id, paypal_capture_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'Already Captured Item',
        1,
        25.0,
        25.0,
        'allow',
        JSON.stringify(['all checks passed']),
        0.0,
        'ORDER_CAPTURED_123',
        'CAPTURE_EXISTING_456',
      ]
    );
    const idRes = db.exec('SELECT last_insert_rowid() as id');
    const capturedLogId = idRes[0]?.values[0]?.[0] as number;
    persistDb(db);

    const res = await fetch(`${baseUrl}/api/paypal/capture-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: 'ORDER_CAPTURED_123', logId: capturedLogId }),
    });
    expect(res.status).toBe(409);
    const data = (await res.json()) as any;
    expect(data.error).toContain('Order has already been captured');
    expect(data.captureId).toBe('CAPTURE_EXISTING_456');
    expect(mockCaptureOrder).toHaveBeenCalledTimes(0);
  });

  test('5. Assertion: Mocked PayPal SDK createOrder and captureOrder call count = 0 for Scenario B', async () => {
    // Step 1: Propose Scenario B (Malicious)
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
    const propData = (await propRes.json()) as any;

    // Step 2: Evaluate Scenario B -> blocked
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
    const evalData = (await evalRes.json()) as any;
    expect(evalData.verdict).toBe('block');

    // Step 3: Malicious caller tries to force create-order on blocked Scenario B logId
    const orderRes = await fetch(`${baseUrl}/api/paypal/create-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ logId: evalData.logId }),
    });
    expect(orderRes.status).toBe(403);

    // Step 4: Malicious caller tries to force capture-order on blocked Scenario B logId
    const captureRes = await fetch(`${baseUrl}/api/paypal/capture-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: 'INJECTED_ORDER_ID', logId: evalData.logId }),
    });
    expect(captureRes.status).toBe(403);

    // STRICT ASSERTIONS:
    expect(mockCreateOrder).toHaveBeenCalledTimes(0);
    expect(mockCaptureOrder).toHaveBeenCalledTimes(0);
  });
});

