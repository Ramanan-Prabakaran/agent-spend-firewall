import { Router, Request, Response } from 'express';
import {
  getOrdersController,
  ApiError,
  CheckoutPaymentIntent,
  FRONTEND_URL,
} from '../lib/paypal';
import {
  ItemCategory,
  OrderApplicationContextUserAction,
} from '@paypal/paypal-server-sdk';
import { getDb, persistDb } from '../db/database';

const router = Router();

interface LinkDescription {
  href: string;
  rel: string;
  method?: string;
}

/**
 * POST /api/paypal/create-order
 * Body: { logId }
 *
 * SECURITY: Amount is ALWAYS recomputed server-side from the decision_log row.
 *           Client never supplies a dollar value.
 *           Only rows with verdict='allow' may proceed.
 *
 * Returns: { orderId, approvalUrl, serverTotal }
 *
 * The frontend MUST redirect/open the buyer to `approvalUrl`
 * (https://www.sandbox.paypal.com/checkoutnow?token=…) so the buyer can
 * authenticate with their Sandbox Personal account and approve the payment.
 * This is a real browser step — not mocked.
 */
router.post('/create-order', async (req: Request, res: Response) => {
  try {
    const { logId } = req.body as { logId: number };

    if (!logId) {
      res.status(400).json({ error: 'logId is required' });
      return;
    }

    const db = await getDb();
    const result = db.exec(
      `SELECT id, verdict, item_name, qty, unit_price FROM decision_log WHERE id = ?`,
      [logId]
    );

    if (!result.length || !result[0].values.length) {
      res.status(404).json({ error: `No decision log entry with id=${logId}` });
      return;
    }

    const { columns, values } = result[0];
    const row: Record<string, unknown> = {};
    columns.forEach((col: string, i: number) => { row[col] = values[0][i]; });

    if (row['verdict'] !== 'allow') {
      console.warn(
        `[paypal/create-order] REFUSED: logId=${logId} has verdict="${row['verdict']}". PayPal API was NOT called.`
      );
      res.status(403).json({
        error: 'Firewall verdict is not "allow" — PayPal order creation refused.',
        verdict: row['verdict'],
      });
      return;
    }

    // Server-side amount recompute — never trust client input
    const qty = row['qty'] as number;
    const unitPrice = row['unit_price'] as number;
    const serverTotal = (qty * unitPrice).toFixed(2);
    const itemName = row['item_name'] as string;

    const ordersController = getOrdersController();

    const { result: order, statusCode } = await ordersController.createOrder({
      body: {
        intent: CheckoutPaymentIntent.Capture,
        purchaseUnits: [
          {
            description: itemName,
            amount: {
              currencyCode: 'USD',
              value: serverTotal,
              breakdown: {
                itemTotal: { currencyCode: 'USD', value: serverTotal },
              },
            },
            items: [
              {
                name: itemName,
                quantity: String(qty),
                unitAmount: { currencyCode: 'USD', value: unitPrice.toFixed(2) },
                category: ItemCategory.PhysicalGoods,
              },
            ],
          },
        ],
        // applicationContext tells PayPal where to redirect after buyer approves
        applicationContext: {
          brandName: 'AI Agent Spend Firewall',
          userAction: OrderApplicationContextUserAction.PayNow,
          returnUrl: `${FRONTEND_URL}/return?logId=${logId}&approved=true`,
          cancelUrl: `${FRONTEND_URL}/result/${logId}?approved=false`,
        },
      },
      prefer: 'return=representation',
    });

    if (statusCode !== 201 && statusCode !== 200) {
      throw new Error(`Unexpected PayPal status ${statusCode}`);
    }

    // Extract the buyer-approval URL from the links array
    const links = (order.links ?? []) as LinkDescription[];
    const approvalUrl = links.find(
      (l) => l.rel === 'approve' || l.rel === 'payer-action'
    )?.href;

    if (!approvalUrl) {
      throw new Error('PayPal order created but no approval URL in response links.');
    }

    const orderId = order.id ?? '';
    db.run(`UPDATE decision_log SET paypal_order_id = ? WHERE id = ?`, [orderId, logId]);
    persistDb(db);

    console.log(
      `[paypal] Order created: id=${order.id} logId=${logId} total=$${serverTotal}`
    );
    console.log(`[paypal] Approval URL: ${approvalUrl}`);

    res.status(201).json({
      orderId: order.id,
      approvalUrl,          // frontend redirects buyer here — www.sandbox.paypal.com
      serverTotal,
      status: order.status,
    });
  } catch (err) {
    if (err instanceof ApiError) {
      console.error('[paypal/create-order] ApiError', err.statusCode, err.body);
      res.status(err.statusCode ?? 500).json({ error: err.message, detail: err.body });
    } else {
      console.error('[paypal/create-order]', err);
      res.status(500).json({ error: (err as Error).message });
    }
  }
});

/**
 * POST /api/paypal/capture-order
 * Body: { orderId, logId }
 *
 * Rejection checks:
 * 1. Missing logId or orderId -> 400
 * 2. Unknown logId -> 404
 * 3. verdict != "allow" -> 403
 * 4. order not created -> 400
 * 5. already captured -> 409 Conflict (idempotency guard)
 */
router.post('/capture-order', async (req: Request, res: Response) => {
  try {
    const { orderId, logId } = req.body as { orderId?: string; logId: number };

    if (!logId) {
      res.status(400).json({ error: 'logId is required' });
      return;
    }

    const db = await getDb();
    const result = db.exec(
      `SELECT id, verdict, paypal_order_id, paypal_capture_id FROM decision_log WHERE id = ?`,
      [logId]
    );

    if (!result.length || !result[0].values.length) {
      res.status(404).json({ error: `No decision log entry with id=${logId}` });
      return;
    }

    const { columns, values } = result[0];
    const row: Record<string, unknown> = {};
    columns.forEach((col: string, i: number) => { row[col] = values[0][i]; });

    // Check 1: Verdict must be allow
    if (row['verdict'] !== 'allow') {
      res.status(403).json({ error: 'Firewall verdict is not "allow" — capture refused.' });
      return;
    }

    // Check 2: Order must have been created
    const storedOrderId = row['paypal_order_id'] as string | null;
    if (!storedOrderId) {
      res.status(400).json({ error: 'PayPal order has not been created for this decision.' });
      return;
    }

    // Check 3: If client provided an orderId, return 400 if it mismatches stored orderId
    if (orderId && orderId !== storedOrderId) {
      res.status(400).json({
        error: `Client orderId does not match the stored orderId (${storedOrderId}) for logId=${logId}.`,
      });
      return;
    }

    // Check 4: Already captured -> 409 Conflict (idempotent)
    if (row['paypal_capture_id']) {
      res.status(409).json({
        error: 'Order has already been captured.',
        captureId: row['paypal_capture_id'],
      });
      return;
    }

    // Always use the server-stored order ID
    const ordersController = getOrdersController();

    const { result: capture, statusCode } = await ordersController.captureOrder({
      id: storedOrderId,
      prefer: 'return=representation',
    });

    if (statusCode !== 201 && statusCode !== 200) {
      throw new Error(`Unexpected PayPal capture status ${statusCode}`);
    }

    const captureRecord = capture.purchaseUnits?.[0]?.payments?.captures?.[0];
    const captureId = captureRecord?.id ?? null;

    if (captureId) {
      db.run(`UPDATE decision_log SET paypal_capture_id = ? WHERE id = ?`, [captureId, logId]);
      persistDb(db);
    }

    console.log(
      `[paypal] Captured: orderId=${orderId} captureId=${captureId} status=${captureRecord?.status}`
    );

    res.json({
      orderId: capture.id,
      captureId,
      orderStatus: capture.status,
      captureStatus: captureRecord?.status,
      amount: captureRecord?.amount,
    });
  } catch (err) {
    if (err instanceof ApiError) {
      console.error('[paypal/capture-order] ApiError', err.statusCode, err.body);
      res.status(err.statusCode ?? 500).json({ error: err.message, detail: err.body });
    } else {
      console.error('[paypal/capture-order]', err);
      res.status(500).json({ error: (err as Error).message });
    }
  }
});

/**
 * GET /api/paypal/order/:orderId
 * Fetch current order state from PayPal (useful after return_url redirect to check status).
 */
router.get('/order/:orderId', async (req: Request, res: Response) => {
  try {
    const { orderId } = req.params;
    const ordersController = getOrdersController();
    const { result: order } = await ordersController.getOrder({ id: orderId });
    res.json(order);
  } catch (err) {
    if (err instanceof ApiError) {
      res.status(err.statusCode ?? 500).json({ error: err.message });
    } else {
      console.error('[paypal/order]', err);
      res.status(500).json({ error: (err as Error).message });
    }
  }
});

export default router;
