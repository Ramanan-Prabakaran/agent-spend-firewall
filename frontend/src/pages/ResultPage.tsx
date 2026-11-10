import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';

interface RuleEvaluation {
  ruleName: string;
  passed: boolean;
  message: string;
}

interface DecisionRecord {
  id: number;
  created_at: string;
  item_name: string;
  qty: number;
  unit_price: number;
  total_usd: number;
  verdict: 'allow' | 'block';
  reasons: string[];
  injection_score: number | null;
  injection_details?: string[];
  shipping_address?: string | null;
  rules_breakdown?: RuleEvaluation[];
  paypal_order_id: string | null;
  paypal_capture_id: string | null;
  source_text: string | null;
}

export default function ResultPage() {
  const { logId } = useParams<{ logId: string }>();
  const [decision, setDecision] = useState<DecisionRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // PayPal checkout state
  const [orderLoading, setOrderLoading] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);

  const fetchDecision = () => {
    if (!logId) return;
    setLoading(true);
    fetch(`/api/firewall/decision/${logId}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Decision #${logId} not found (${res.status})`);
        return res.json();
      })
      .then((data: DecisionRecord) => {
        setDecision(data);
        setError(null);
      })
      .catch((err) => {
        console.error(err);
        setError((err as Error).message);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchDecision();
  }, [logId]);

  const handleCreatePayPalOrder = async () => {
    if (!decision) return;
    setOrderLoading(true);
    setOrderError(null);

    try {
      // Security hard rule: Client sends ONLY logId, never amounts
      const res = await fetch('/api/paypal/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logId: decision.id }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `Failed to create PayPal order (${res.status})`);
      }

      const orderData = await res.json();

      // Redirect buyer to PayPal Sandbox approval screen
      if (orderData.approvalUrl) {
        window.location.href = orderData.approvalUrl;
      } else {
        throw new Error('No approval URL returned from PayPal.');
      }
    } catch (err) {
      console.error(err);
      setOrderError((err as Error).message);
      setOrderLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="card loading">
        <span className="spinner" style={{ marginBottom: 12 }}></span>
        <p>Loading firewall evaluation details...</p>
      </div>
    );
  }

  if (error || !decision) {
    return (
      <div className="card">
        <div className="alert alert-danger">{error || 'Decision not found'}</div>
        <Link to="/" className="btn btn-primary">
          ← Back to Simulator
        </Link>
      </div>
    );
  }

  const isAllowed = decision.verdict === 'allow';
  const isCaptured = Boolean(decision.paypal_capture_id);
  const isOrderCreated = Boolean(decision.paypal_order_id);

  // Parse rules or fallback to reasons
  const rules = decision.rules_breakdown && decision.rules_breakdown.length > 0
    ? decision.rules_breakdown
    : decision.reasons.map((r) => ({
        ruleName: 'Deterministic Policy Evaluation',
        passed: isAllowed,
        message: r,
      }));

  return (
    <div>
      {/* Big ALLOW / BLOCK Banner */}
      <div className={`banner ${isAllowed ? 'banner-allow' : 'banner-block'}`}>
        <div>
          <div className="banner-headline">
            {isAllowed ? 'VERDICT: ALLOWED' : 'VERDICT: BLOCKED'}
          </div>
          <div className="banner-desc">
            {isAllowed
              ? 'All deterministic safety checks passed. Transaction is permitted to reach PayPal.'
              : 'Firewall detected policy violation or prompt injection. Transaction rejected.'}
          </div>
        </div>
        <div style={{ fontSize: '2.5rem' }}>{isAllowed ? '✅' : '🛑'}</div>
      </div>

      {/* BLOCK State Notice */}
      {!isAllowed && (
        <div className="alert alert-danger" style={{ fontWeight: 600 }}>
          🔒 PayPal was NEVER called. No sandbox order was initialized or charged.
        </div>
      )}

      {/* Captured Confirmation Notice */}
      {isCaptured && (
        <div className="alert alert-info" style={{ fontWeight: 600 }}>
          🎉 Payment Successfully Captured! PayPal Sandbox Order is COMPLETED.
        </div>
      )}

      {orderError && <div className="alert alert-danger">{orderError}</div>}

      {/* 1. Normalized Transaction Details (Extracted Fields) */}
      <div className="card">
        <h2 className="card-title">Normalized Purchase Proposal</h2>
        <p className="card-subtitle">
          Structured transaction data parsed from the upstream listing by AI normalizer.
        </p>

        <div className="grid-2">
          <div className="stat-box">
            <div className="stat-label">Item Name</div>
            <div className="stat-val">{decision.item_name}</div>
          </div>
          <div className="stat-box">
            <div className="stat-label">Quantity</div>
            <div className="stat-val">{decision.qty} unit{decision.qty > 1 ? 's' : ''}</div>
          </div>
          <div className="stat-box">
            <div className="stat-label">Unit Price</div>
            <div className="stat-val">${decision.unit_price.toFixed(2)} USD</div>
          </div>
          <div className="stat-box">
            <div className="stat-label">Calculated Total</div>
            <div className="stat-val" style={{ color: isAllowed ? 'var(--success)' : 'var(--danger)' }}>
              ${decision.total_usd.toFixed(2)} USD
            </div>
          </div>
          <div className="stat-box" style={{ gridColumn: 'span 2' }}>
            <div className="stat-label">Target Shipping Address</div>
            <div className="stat-val" style={{ fontSize: '0.95rem' }}>
              {decision.shipping_address || 'Registered delivery address'}
            </div>
          </div>
        </div>
      </div>

      {/* 2. AI Prompt Injection Scan Results + Flags */}
      <div className="card">
        <h2 className="card-title">AI Prompt Injection & Manipulation Scan</h2>
        <p className="card-subtitle">
          LLM analysis of raw text looking for hidden instructions, overrides, or unauthorized redirections.
        </p>

        <div className="stat-box" style={{ marginBottom: 16 }}>
          <div className="stat-label">Adversarial Injection Score</div>
          <div
            className="stat-val"
            style={{
              color:
                decision.injection_score != null && decision.injection_score >= 0.6
                  ? 'var(--danger)'
                  : 'var(--success)',
            }}
          >
            {decision.injection_score != null ? decision.injection_score.toFixed(2) : '0.00'} / 1.00
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginLeft: 8 }}>
              (Threshold: 0.60)
            </span>
          </div>
        </div>

        {decision.injection_score != null && decision.injection_score >= 0.6 ? (
          <div className="alert alert-danger" style={{ marginBottom: 0 }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>
              ⚠️ Malicious prompt injection pattern flagged in source listing.
            </div>
            {decision.injection_details && decision.injection_details.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 600, textTransform: 'uppercase' }}>
                  Suspicious Indicators Detected:
                </span>
                <ul style={{ margin: '6px 0 0 20px', padding: 0 }}>
                  {decision.injection_details.map((flag, idx) => (
                    <li key={idx} style={{ marginTop: 4 }}>
                      <code>{flag}</code>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <div className="alert alert-info" style={{ marginBottom: 0 }}>
            ✓ Clean: No prompt injection or adversarial manipulation detected.
          </div>
        )}
      </div>

      {/* 3. Deterministic Policy Rule Checklist (Failed rules highlighted) */}
      <div className="card">
        <h2 className="card-title">Deterministic Policy Rule Evaluation</h2>
        <p className="card-subtitle">
          The rules engine makes the final monetary call, not the LLM. Every check is evaluated deterministically.
        </p>

        <div>
          {rules.map((rule, idx) => (
            <div
              key={idx}
              className={`rule-card ${rule.passed ? 'rule-pass' : 'rule-fail'}`}
            >
              <div className="rule-header">
                <div className="rule-name">
                  <span>{rule.passed ? '✅' : '❌'}</span>
                  <span>{rule.ruleName}</span>
                </div>
                <span className={`badge ${rule.passed ? 'badge-allow' : 'badge-block'}`}>
                  {rule.passed ? 'PASS' : 'FAIL'}
                </span>
              </div>
              <div className="rule-message">{rule.message}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 4. Live PayPal Sandbox Integration Actions (Hidden on BLOCK) */}
      {isAllowed && (
        <div className="card">
          <h2 className="card-title">PayPal Sandbox Order Execution</h2>
          <p className="card-subtitle">
            Secure create-order and capture-order flow. Server recalculates amounts independently.
          </p>

          {isCaptured ? (
            <div>
              <div className="grid-2" style={{ marginBottom: 16 }}>
                <div className="stat-box">
                  <div className="stat-label">PayPal Order ID</div>
                  <div className="stat-val" style={{ fontFamily: 'monospace', fontSize: '0.95rem' }}>
                    {decision.paypal_order_id}
                  </div>
                </div>
                <div className="stat-box">
                  <div className="stat-label">PayPal Capture ID</div>
                  <div className="stat-val" style={{ fontFamily: 'monospace', fontSize: '0.95rem', color: 'var(--success)' }}>
                    {decision.paypal_capture_id}
                  </div>
                </div>
              </div>
              <div style={{ color: 'var(--success)', fontWeight: 600 }}>
                ✓ Real PayPal Sandbox order successfully created and captured end-to-end.
              </div>
            </div>
          ) : isOrderCreated ? (
            <div>
              <div className="alert alert-info">
                Order initialized: <code style={{ fontWeight: 700 }}>{decision.paypal_order_id}</code>. Awaiting buyer sandbox approval.
              </div>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleCreatePayPalOrder}
                disabled={orderLoading}
              >
                {orderLoading ? 'Redirecting...' : 'Re-open PayPal Approval Screen →'}
              </button>
            </div>
          ) : (
            <div>
              <button
                type="button"
                className="btn btn-success"
                onClick={handleCreatePayPalOrder}
                disabled={orderLoading}
                style={{ padding: '12px 24px', fontSize: '1rem' }}
              >
                {orderLoading ? (
                  <>
                    <span className="spinner"></span>
                    Initializing PayPal Sandbox Order...
                  </>
                ) : (
                  'Proceed to PayPal Sandbox Checkout →'
                )}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Navigation Footer */}
      <div style={{ display: 'flex', gap: 12 }}>
        <Link to="/" className="btn btn-primary">
          ← Test Another Transaction
        </Link>
        <Link to="/log" className="btn btn-primary" style={{ background: 'var(--surface-hover)' }}>
          View Full Decision Log →
        </Link>
      </div>
    </div>
  );
}
