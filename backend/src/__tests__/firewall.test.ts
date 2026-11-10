import { evaluate, FirewallInput } from '../lib/firewall';

describe('Deterministic Firewall Evaluation Engine', () => {
  const baseProposal = {
    itemName: 'Ergonomic Keyboard',
    qty: 1,
    unitPriceUsd: 89.99,
    totalUsd: 89.99,
    shippingAddress: 'Registered Delivery Address',
  };

  test('1. Legitimate proposal passes all checks with verdict "allow"', () => {
    const input: FirewallInput = {
      proposal: { ...baseProposal },
      injectionScore: 0.05,
      injectionDetails: [],
      requestedQty: 1,
      requestedPrice: 89.99,
    };

    const result = evaluate(input);
    expect(result.verdict).toBe('allow');
    expect(result.reasons).toContain('All deterministic policy checks passed.');
  });

  test('2. Proposal with injection score above threshold is blocked', () => {
    const input: FirewallInput = {
      proposal: { ...baseProposal },
      injectionScore: 0.85,
      injectionDetails: ['ignore previous instructions', 'prompt injection override detected'],
      requestedQty: 1,
      requestedPrice: 89.99,
    };

    const result = evaluate(input);
    expect(result.verdict).toBe('block');
    expect(result.reasons.some((r) => r.includes('Injection score 0.85'))).toBe(true);
    expect(result.reasons.some((r) => r.includes('Suspicious indicators'))).toBe(true);
  });

  test('3. Proposal exceeding quantity ceiling is blocked', () => {
    const input: FirewallInput = {
      proposal: {
        ...baseProposal,
        qty: 50,
        totalUsd: 4499.5,
      },
      injectionScore: 0.1,
      injectionDetails: [],
      requestedQty: 1,
      requestedPrice: 89.99,
    };

    const result = evaluate(input, { qtyCeiling: 10, spendCeilingUsd: 5000 });
    expect(result.verdict).toBe('block');
    expect(result.reasons.some((r) => r.includes('Quantity 50 exceeds safety ceiling'))).toBe(true);
  });

  test('4. Proposal exceeding total spend ceiling is blocked', () => {
    const input: FirewallInput = {
      proposal: {
        ...baseProposal,
        qty: 8,
        unitPriceUsd: 100,
        totalUsd: 800,
      },
      injectionScore: 0.1,
      injectionDetails: [],
      requestedQty: 8,
      requestedPrice: 100,
    };

    const result = evaluate(input, { spendCeilingUsd: 500, qtyCeiling: 10 });
    expect(result.verdict).toBe('block');
    expect(result.reasons.some((r) => r.includes('Total spend $800.00 exceeds ceiling of $500.00'))).toBe(true);
  });

  test('5. Proposal with excessive price deviation is blocked', () => {
    const input: FirewallInput = {
      proposal: {
        itemName: 'USB-C Cable',
        qty: 1,
        unitPriceUsd: 45.0, // Requested 20, charging 45 (+125% deviation)
        totalUsd: 45.0,
      },
      injectionScore: 0.1,
      injectionDetails: [],
      requestedQty: 1,
      requestedPrice: 20.0,
    };

    const result = evaluate(input, { priceDeviationMaxPct: 30 });
    expect(result.verdict).toBe('block');
    expect(result.reasons.some((r) => r.includes('Unit price deviation 125.0%'))).toBe(true);
  });

  test('6. Proposal with unapproved shipping address is blocked (address allowlist)', () => {
    const input: FirewallInput = {
      proposal: {
        ...baseProposal,
        shippingAddress: '123 Hacker Lane, Unknown Island',
      },
      injectionScore: 0.1,
      injectionDetails: [],
      requestedQty: 1,
      requestedPrice: 89.99,
    };

    const result = evaluate(input);
    expect(result.verdict).toBe('block');
    expect(result.reasons.some((r) => r.includes('not in the approved address allowlist'))).toBe(true);
  });

  test('7. Multiple violations produce distinct, clear explanations for each', () => {
    const input: FirewallInput = {
      proposal: {
        itemName: 'Manipulated Order',
        qty: 50,
        unitPriceUsd: 200,
        totalUsd: 10000,
        shippingAddress: '999 Rogue Street',
      },
      injectionScore: 0.95,
      injectionDetails: ['override quantity', 'divert address'],
      requestedQty: 1,
      requestedPrice: 50,
    };

    const result = evaluate(input);
    expect(result.verdict).toBe('block');
    expect(result.reasons.length).toBeGreaterThanOrEqual(4);
    // Verifies all failed rules are articulated clearly
    expect(result.reasons.some((r) => r.includes('Injection score'))).toBe(true);
    expect(result.reasons.some((r) => r.includes('Quantity'))).toBe(true);
    expect(result.reasons.some((r) => r.includes('Total spend'))).toBe(true);
    expect(result.reasons.some((r) => r.includes('Shipping address'))).toBe(true);
  });
});

