import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

interface Scenario {
  id: string;
  title: string;
  description: string;
  requestedItem: string;
  requestedQty: number;
  requestedPrice: number;
  sourceText: string;
  expectedVerdict: 'allow' | 'block';
}

export default function SimulatorPage() {
  const navigate = useNavigate();
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>('');
  const [requestedItem, setRequestedItem] = useState('');
  const [requestedQty, setRequestedQty] = useState(1);
  const [requestedPrice, setRequestedPrice] = useState(0);
  const [sourceText, setSourceText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/agent/scenarios')
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load scenarios (${res.status})`);
        return res.json();
      })
      .then((data: Scenario[]) => {
        setScenarios(data);
        if (data.length > 0) {
          applyScenario(data[0]);
        }
      })
      .catch((err) => {
        console.error(err);
        setError('Failed to load predefined scenarios. Backend might be offline.');
      });
  }, []);

  const applyScenario = (sc: Scenario) => {
    setSelectedScenarioId(sc.id);
    setRequestedItem(sc.requestedItem);
    setRequestedQty(sc.requestedQty);
    setRequestedPrice(sc.requestedPrice);
    setSourceText(sc.sourceText);
    setError(null);
  };

  const handleScenarioChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    const found = scenarios.find((s) => s.id === id);
    if (found) {
      applyScenario(found);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      // Step 1: Agent proposes transaction via LLM normalization & injection scanning
      const propRes = await fetch('/api/agent/propose-transaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceText,
          requestedItem,
          requestedQty: Number(requestedQty),
          requestedPrice: Number(requestedPrice),
        }),
      });

      if (!propRes.ok) {
        const errJson = await propRes.json().catch(() => ({}));
        throw new Error(errJson.error || `Agent proposal failed (${propRes.status})`);
      }

      const propData = await propRes.json();

      // Step 2: Deterministic firewall evaluates the proposal
      const evalRes = await fetch('/api/firewall/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proposal: propData.proposal,
          injectionScore: propData.injectionScore,
          injectionDetails: propData.injectionDetails,
          requestedQty: Number(requestedQty),
          requestedPrice: Number(requestedPrice),
          sourceText,
        }),
      });

      if (!evalRes.ok) {
        const errJson = await evalRes.json().catch(() => ({}));
        throw new Error(errJson.error || `Firewall evaluation failed (${evalRes.status})`);
      }

      const evalData = await evalRes.json();
      navigate(`/result/${evalData.logId}`);
    } catch (err) {
      console.error(err);
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="card">
        <h1 className="card-title">Autonomous Agent Transaction Simulator</h1>
        <p className="card-subtitle">
          Simulate an AI purchasing agent encountering an upstream listing. The firewall scans for prompt injection and applies deterministic spending policies before any PayPal call is permitted.
        </p>

        {error && <div className="alert alert-danger">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="label">Choose Preset Scenario</label>
            <select
              className="select"
              value={selectedScenarioId}
              onChange={handleScenarioChange}
              disabled={loading}
            >
              {scenarios.map((sc) => (
                <option key={sc.id} value={sc.id}>
                  {sc.title} — Expected: {sc.expectedVerdict.toUpperCase()}
                </option>
              ))}
            </select>
          </div>

          <div className="grid-2 form-group">
            <div>
              <label className="label">Agent Intended Item</label>
              <input
                type="text"
                className="input"
                value={requestedItem}
                onChange={(e) => setRequestedItem(e.target.value)}
                required
                disabled={loading}
              />
            </div>
            <div>
              <label className="label">Intended Quantity</label>
              <input
                type="number"
                min="1"
                className="input"
                value={requestedQty}
                onChange={(e) => setRequestedQty(parseInt(e.target.value, 10) || 1)}
                required
                disabled={loading}
              />
            </div>
          </div>

          <div className="form-group">
            <label className="label">Expected Unit Price ($ USD)</label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              className="input"
              value={requestedPrice}
              onChange={(e) => setRequestedPrice(parseFloat(e.target.value) || 0)}
              required
              disabled={loading}
            />
          </div>

          <div className="form-group">
            <label className="label">
              Upstream Source Text (Product Listing / Web Content Read by Agent)
            </label>
            <textarea
              className="textarea"
              value={sourceText}
              onChange={(e) => setSourceText(e.target.value)}
              required
              rows={8}
              disabled={loading}
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%', padding: '14px' }}
            disabled={loading}
          >
            {loading ? (
              <>
                <span className="spinner"></span>
                Analyzing with AI & Evaluating Firewall Rules...
              </>
            ) : (
              'Run Through Firewall →'
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
