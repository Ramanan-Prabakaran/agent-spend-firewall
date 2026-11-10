import { Router, Request, Response } from 'express';
import { evaluate, FirewallInput } from '../lib/firewall';
import { getDb, persistDb } from '../db/database';

const router = Router();

/**
 * POST /api/firewall/evaluate
 * Body: { proposal, injectionScore, injectionDetails, requestedQty, requestedPrice, sourceText? }
 * → Runs deterministic rules → returns { verdict, reasons[], rules[], logId }
 * → Writes decision to decision_log
 */
router.post('/evaluate', async (req: Request, res: Response) => {
  try {
    const input = req.body as FirewallInput & { sourceText?: string };

    if (!input.proposal || input.injectionScore == null) {
      res.status(400).json({ error: 'Missing proposal or injectionScore' });
      return;
    }

    const result = evaluate(input);
    const db = await getDb();

    db.run(
      `INSERT INTO decision_log
        (item_name, qty, unit_price, total_usd, verdict, reasons, injection_score,
         injection_details, shipping_address, rules_breakdown, source_text)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.proposal.itemName,
        input.proposal.qty,
        input.proposal.unitPriceUsd,
        input.proposal.totalUsd,
        result.verdict,
        JSON.stringify(result.reasons),
        input.injectionScore,
        JSON.stringify(input.injectionDetails ?? []),
        input.proposal.shippingAddress ?? 'Registered delivery address',
        JSON.stringify(result.rules ?? []),
        input.sourceText ?? null,
      ]
    );

    // Get last inserted id
    const idResult = db.exec('SELECT last_insert_rowid() as id');
    const logId = idResult[0]?.values[0]?.[0] as number;

    persistDb(db);

    res.json({ ...result, logId });
  } catch (err) {
    console.error('[firewall/evaluate]', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * GET /api/firewall/decision/:id
 * Returns a single decision log entry by id
 */
router.get('/decision/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const db = await getDb();
    const result = db.exec(
      `SELECT id, created_at, item_name, qty, unit_price, total_usd,
              verdict, reasons, injection_score, injection_details,
              shipping_address, rules_breakdown,
              paypal_order_id, paypal_capture_id, source_text
       FROM decision_log WHERE id = ?`,
      [id]
    );

    if (!result.length || !result[0].values.length) {
      res.status(404).json({ error: `Decision not found: id=${id}` });
      return;
    }

    const { columns, values } = result[0];
    const obj: Record<string, unknown> = {};
    columns.forEach((col: string, i: number) => { obj[col] = values[0][i]; });
    
    // Safely parse JSON columns
    try {
      obj['reasons'] = JSON.parse(obj['reasons'] as string);
    } catch {
      obj['reasons'] = [obj['reasons']];
    }

    try {
      obj['injection_details'] = obj['injection_details'] ? JSON.parse(obj['injection_details'] as string) : [];
    } catch {
      obj['injection_details'] = [];
    }

    try {
      obj['rules_breakdown'] = obj['rules_breakdown'] ? JSON.parse(obj['rules_breakdown'] as string) : [];
    } catch {
      obj['rules_breakdown'] = [];
    }

    res.json(obj);
  } catch (err) {
    console.error('[firewall/decision/:id]', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * GET /api/firewall/decision-log
 * Returns all log entries, newest first
 */
router.get('/decision-log', async (_req: Request, res: Response) => {
  try {
    const db = await getDb();
    const result = db.exec(
      `SELECT id, created_at, item_name, qty, unit_price, total_usd,
              verdict, reasons, injection_score,
              paypal_order_id, paypal_capture_id
       FROM decision_log ORDER BY id DESC`
    );

    if (!result.length) {
      res.json([]);
      return;
    }

    const { columns, values } = result[0];
    const rows = values.map((row: unknown[]) => {
      const obj: Record<string, unknown> = {};
      columns.forEach((col: string, i: number) => { obj[col] = row[i]; });
      try {
        obj['reasons'] = JSON.parse(obj['reasons'] as string);
      } catch {
        obj['reasons'] = [obj['reasons']];
      }
      return obj;
    });

    res.json(rows);
  } catch (err) {
    console.error('[firewall/decision-log]', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
