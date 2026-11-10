import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';

export default function ReturnHandler() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<string>('Processing PayPal Sandbox approval...');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = searchParams.get('token'); // PayPal Order ID
    const logId = searchParams.get('logId');
    const approved = searchParams.get('approved');

    if (approved === 'false') {
      if (logId) {
        navigate(`/result/${logId}?cancelled=true`);
      } else {
        navigate('/');
      }
      return;
    }

    if (!token || !logId) {
      setError('Missing PayPal order token or decision logId in redirect parameters.');
      return;
    }

    setStatus(`Capturing approved PayPal order (${token})...`);

    // Call server-side capture endpoint: sends ONLY orderId and logId
    fetch('/api/paypal/capture-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId: token,
        logId: Number(logId),
      }),
    })
      .then(async (res) => {
        if (res.status === 409) {
          // Idempotent: already captured
          return res.json();
        }
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `PayPal capture failed with status ${res.status}`);
        }
        return res.json();
      })
      .then(() => {
        setStatus('Payment captured! Redirecting to confirmation...');
        navigate(`/result/${logId}`);
      })
      .catch((err) => {
        console.error('[return-capture]', err);
        setError((err as Error).message);
      });
  }, [searchParams, navigate]);

  return (
    <div className="card" style={{ textAlign: 'center', padding: '48px 24px' }}>
      {error ? (
        <div>
          <div className="alert alert-danger" style={{ textAlign: 'left' }}>
            <strong>Capture Error:</strong> {error}
          </div>
          <Link to="/" className="btn btn-primary">
            ← Return to Simulator
          </Link>
        </div>
      ) : (
        <div>
          <span className="spinner" style={{ width: 32, height: 32, marginBottom: 16 }}></span>
          <h2 className="card-title">{status}</h2>
          <p className="card-subtitle">
            Verifying PayPal Sandbox transaction and updating decision audit records.
          </p>
        </div>
      )}
    </div>
  );
}
