import { Router, Request, Response } from 'express';
import { parseProposeWithLLM } from '../lib/llm';
import { SEED_SCENARIOS } from '../lib/scenarios';

const router = Router();

/**
 * GET /api/agent/scenarios
 * Returns predefined Scenario A (legitimate) and Scenario B (malicious) seed data.
 */
router.get('/scenarios', (_req: Request, res: Response) => {
  res.json(SEED_SCENARIOS);
});

/**
 * POST /api/agent/propose-transaction
 * Body: { sourceText, requestedItem, requestedQty, requestedPrice }
 * → LLM normalizes + injection-scores the source text
 * → Returns: { proposal, injectionScore, injectionDetails }
 */
router.post('/propose-transaction', async (req: Request, res: Response) => {
  try {
    const { sourceText, requestedItem, requestedQty, requestedPrice } = req.body as {
      sourceText: string;
      requestedItem: string;
      requestedQty: number;
      requestedPrice: number;
    };

    if (!sourceText || !requestedItem || requestedQty == null || requestedPrice == null) {
      res.status(400).json({ error: 'Missing required fields: sourceText, requestedItem, requestedQty, requestedPrice' });
      return;
    }

    const llmResult = await parseProposeWithLLM(
      sourceText,
      requestedItem,
      Number(requestedQty),
      Number(requestedPrice)
    );

    res.json({
      proposal: {
        itemName: llmResult.itemName,
        qty: llmResult.qty,
        unitPriceUsd: llmResult.unitPriceUsd,
        totalUsd: llmResult.totalUsd,
        shippingAddress: llmResult.shippingAddress,
      },
      injectionScore: llmResult.injectionScore,
      injectionDetails: llmResult.injectionDetails,
    });
  } catch (err) {
    console.error('[agent/propose-transaction]', err);
    // 503 Service Unavailable with clear rejection message
    res.status(503).json({ error: (err as Error).message });
  }
});

export default router;
