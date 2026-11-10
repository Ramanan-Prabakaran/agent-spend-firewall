import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';

interface DecisionLogItem {
  id: number;
  created_at: string;
  item_name: string;
  qty: number;
  unit_price: number;
  total_usd: number;
  verdict: 'allow' | 'block';
  reasons: string[];
  injection_score: number | null;
  paypal_order_id: string | null;
  paypal_capture_id: string | null;
}

export default function DecisionLogPage() {
  const [logs, setLogs] = useState<DecisionLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLogs = () => {
    setLoading(true);
    fetch('/api/firewall/decision-log')
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load decision log (${res.status})`);
        return res.json();
      })
      .then((data: DecisionLogItem[]) => {
        setLogs(data);
        setError(null);
      })
      .catch((err) => {
        console.error(err);
        setError((err as Error).message);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  return (
    <div>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <h1 className="card-title">Firewall Decision Audit Log</h1>
            <p className="card-subtitle" style={{ marginBottom: 0 }}>
              Immutable record of every transaction evaluated by the safety firewall.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={fetchLogs}
            disabled={loading}
            style={{ padding: '8px 16px', fontSize: '0.85rem' }}
          >
            {loading ? 'Refreshing...' : '🔄 Refresh'}
          </button>
        </div>

        {error && <div className="alert alert-danger">{error}</div>}

        {loading ? (
          <div className="loading">
            <span className="spinner"></span>
            <p style={{ marginTop: 8 }}>Loading decision audit trail...</p>
          </div>
        ) : logs.length === 0 ? (
          <div className="loading">
            <p>No transactions evaluated yet.</p>
            <Link to="/" className="btn btn-primary" style={{ marginTop: 12 }}>
              Run First Simulation →
            </Link>
          </div>
        ) : (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Verdict</th>
                  <th>Item</th>
                  <th>Qty</th>
                  <th>Total</th>
                  <th>Inj Score</th>
                  <th>PayPal Order</th>
                  <th>PayPal Capture</th>
                  <th>Timestamp</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => {
                  const isAllow = log.verdict === 'allow';
                  return (
                    <tr key={log.id}>
                      <td>
                        <span className={`badge ${isAllow ? 'badge-allow' : 'badge-block'}`}>
                          {log.verdict}
                        </span>
                      </td>
                      <td style={{ fontWeight: 600 }}>{log.item_name}</td>
                      <td>{log.qty}</td>
                      <td>${log.total_usd.toFixed(2)}</td>
                      <td>
                        <span
                          style={{
                            fontWeight: 600,
                            color:
                              log.injection_score != null && log.injection_score >= 0.6
                                ? 'var(--danger)'
                                : 'var(--text-muted)',
                          }}
                        >
                          {log.injection_score != null ? log.injection_score.toFixed(2) : '-'}
                        </span>
                      </td>
                      <td style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                        {log.paypal_order_id ? (
                          <span style={{ color: '#93c5fd' }}>{log.paypal_order_id}</span>
                        ) : (
                          <span style={{ color: 'var(--text-muted)' }}>None (Blocked)</span>
                        )}
                      </td>
                      <td style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                        {log.paypal_capture_id ? (
                          <span style={{ color: 'var(--success)', fontWeight: 600 }}>
                            {log.paypal_capture_id}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--text-muted)' }}>None</span>
                        )}
                      </td>
                      <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        {new Date(log.created_at).toLocaleString()}
                      </td>
                      <td>
                        <Link
                          to={`/result/${log.id}`}
                          className="btn btn-primary"
                          style={{ padding: '4px 10px', fontSize: '0.75rem' }}
                        >
                          Details →
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
