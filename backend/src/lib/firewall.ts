// Deterministic policy rules — the LLM never touches this logic.
// All thresholds come from env vars with safe defaults, or can be passed as an override.

export interface FirewallPolicy {
  spendCeilingUsd: number;          // max total order value
  qtyCeiling: number;               // max units per order
  priceDeviationMaxPct: number;     // how much unit_price may differ from requestedPrice
  injectionScoreThreshold: number;  // above this → block regardless of other rules
  allowedAddresses: string[];       // permitted shipping addresses or keywords
}

export function getPolicy(): FirewallPolicy {
  const envAddresses = process.env.ALLOWED_SHIPPING_ADDRESSES
    ? process.env.ALLOWED_SHIPPING_ADDRESSES.split(',').map((s) => s.trim().toLowerCase())
    : [
        'registered delivery address',
        'default shipping address',
        'corporate office',
        'authorized warehouse',
        'primary address',
      ];

  return {
    spendCeilingUsd: parseFloat(process.env.SPEND_CEILING_USD ?? '500'),
    qtyCeiling: parseInt(process.env.QTY_CEILING ?? '10', 10),
    priceDeviationMaxPct: parseFloat(process.env.PRICE_DEVIATION_MAX_PCT ?? '30'),
    injectionScoreThreshold: parseFloat(process.env.INJECTION_SCORE_THRESHOLD ?? '0.6'),
    allowedAddresses: envAddresses,
  };
}

export interface ProposedTransaction {
  itemName: string;
  qty: number;
  unitPriceUsd: number;
  totalUsd: number;
  shippingAddress?: string;
}

export interface FirewallInput {
  proposal: ProposedTransaction;
  injectionScore: number;        // 0–1 from LLM
  injectionDetails: string[];    // human-readable flags from LLM
  requestedQty: number;          // original agent request (pre-LLM)
  requestedPrice: number;        // original agent request (pre-LLM)
}

export interface RuleEvaluation {
  ruleName: string;
  passed: boolean;
  message: string;
}

export interface FirewallResult {
  verdict: 'allow' | 'block';
  reasons: string[];
  rules: RuleEvaluation[];
}

export function evaluate(input: FirewallInput, policyOverride?: Partial<FirewallPolicy>): FirewallResult {
  const policy: FirewallPolicy = {
    ...getPolicy(),
    ...(policyOverride ?? {}),
  };
  const reasons: string[] = [];
  const rules: RuleEvaluation[] = [];

  // Rule 1: Injection score
  const injectionPassed = input.injectionScore < policy.injectionScoreThreshold;
  if (!injectionPassed) {
    const msg = `Injection score ${input.injectionScore.toFixed(2)} ≥ threshold ${policy.injectionScoreThreshold} — suspicious prompt injection or manipulation detected in source text.`;
    reasons.push(msg);
    if (input.injectionDetails.length > 0) {
      reasons.push(`Suspicious indicators: ${input.injectionDetails.join('; ')}`);
    }
    rules.push({
      ruleName: 'Prompt Injection & Manipulation Detection',
      passed: false,
      message: msg,
    });
  } else {
    rules.push({
      ruleName: 'Prompt Injection & Manipulation Detection',
      passed: true,
      message: `Injection score ${input.injectionScore.toFixed(2)} is below threshold ${policy.injectionScoreThreshold} (clean).`,
    });
  }

  // Rule 2: Quantity ceiling
  const qtyPassed = input.proposal.qty <= policy.qtyCeiling;
  if (!qtyPassed) {
    const msg = `Quantity ${input.proposal.qty} exceeds safety ceiling of ${policy.qtyCeiling} units.`;
    reasons.push(msg);
    rules.push({
      ruleName: 'Quantity Safety Ceiling',
      passed: false,
      message: msg,
    });
  } else {
    rules.push({
      ruleName: 'Quantity Safety Ceiling',
      passed: true,
      message: `Quantity (${input.proposal.qty} units) is within safe ceiling of ${policy.qtyCeiling} units.`,
    });
  }

  // Rule 3: Total spend ceiling
  const spendPassed = input.proposal.totalUsd <= policy.spendCeilingUsd;
  if (!spendPassed) {
    const msg = `Total spend $${input.proposal.totalUsd.toFixed(2)} exceeds ceiling of $${policy.spendCeilingUsd.toFixed(2)}.`;
    reasons.push(msg);
    rules.push({
      ruleName: 'Spend Safety Ceiling',
      passed: false,
      message: msg,
    });
  } else {
    rules.push({
      ruleName: 'Spend Safety Ceiling',
      passed: true,
      message: `Total spend ($${input.proposal.totalUsd.toFixed(2)}) is within spend ceiling of $${policy.spendCeilingUsd.toFixed(2)}.`,
    });
  }

  // Rule 4: Price deviation — LLM-extracted price vs agent-requested price
  let pricePassed = true;
  let priceMsg = '';
  if (input.requestedPrice > 0) {
    const deviation =
      (Math.abs(input.proposal.unitPriceUsd - input.requestedPrice) / input.requestedPrice) * 100;
    if (deviation > policy.priceDeviationMaxPct) {
      pricePassed = false;
      priceMsg = `Unit price deviation ${deviation.toFixed(1)}% exceeds allowed threshold of ${policy.priceDeviationMaxPct}% (requested $${input.requestedPrice.toFixed(2)}, proposed $${input.proposal.unitPriceUsd.toFixed(2)}).`;
      reasons.push(priceMsg);
    } else {
      priceMsg = `Unit price deviation (${deviation.toFixed(1)}%) is within allowed threshold of ${policy.priceDeviationMaxPct}%.`;
    }
  } else {
    priceMsg = 'No requested baseline price provided; deviation check skipped.';
  }
  rules.push({
    ruleName: 'Price Deviation Limit',
    passed: pricePassed,
    message: priceMsg,
  });

  // Rule 5: Address allowlist (prevents redirection attacks)
  let addressPassed = true;
  let addressMsg = '';
  const addr = input.proposal.shippingAddress;
  if (addr && addr.trim() !== '') {
    const candidate = addr.trim().toLowerCase();
    const isAllowed = policy.allowedAddresses.some(
      (allowed) => candidate.includes(allowed) || allowed.includes(candidate)
    );
    if (!isAllowed) {
      addressPassed = false;
      addressMsg = `Shipping address "${addr}" is not in the approved address allowlist.`;
      reasons.push(addressMsg);
    } else {
      addressMsg = `Shipping address "${addr}" matches authorized allowlist.`;
    }
  } else {
    addressMsg = 'Default registered delivery address used; address check passed.';
  }
  rules.push({
    ruleName: 'Shipping Address Allowlist',
    passed: addressPassed,
    message: addressMsg,
  });

  // Rule 6: Calculation arithmetic integrity
  const expectedTotal = Number((input.proposal.qty * input.proposal.unitPriceUsd).toFixed(2));
  const arithmeticPassed = Math.abs(input.proposal.totalUsd - expectedTotal) <= 0.05;
  if (!arithmeticPassed) {
    const msg = `Arithmetic mismatch: total $${input.proposal.totalUsd.toFixed(2)} does not match ${input.proposal.qty} × $${input.proposal.unitPriceUsd.toFixed(2)} ($${expectedTotal.toFixed(2)}).`;
    reasons.push(msg);
    rules.push({
      ruleName: 'Arithmetic Integrity Verification',
      passed: false,
      message: msg,
    });
  } else {
    rules.push({
      ruleName: 'Arithmetic Integrity Verification',
      passed: true,
      message: `Total calculation verified: ${input.proposal.qty} × $${input.proposal.unitPriceUsd.toFixed(2)} = $${expectedTotal.toFixed(2)}.`,
    });
  }

  return {
    verdict: reasons.length === 0 ? 'allow' : 'block',
    reasons: reasons.length === 0 ? ['All deterministic policy checks passed.'] : reasons,
    rules,
  };
}
