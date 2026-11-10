import { Routes, Route, Link, useLocation } from 'react-router-dom';
import SimulatorPage from './pages/SimulatorPage';
import ResultPage from './pages/ResultPage';
import DecisionLogPage from './pages/DecisionLogPage';
import ReturnHandler from './pages/ReturnHandler';

export default function App() {
  const location = useLocation();

  return (
    <div>
      <header className="header">
        <div className="header-content">
          <Link to="/" className="brand">
            <span>🛡️ AI Agent Spend Firewall</span>
            <span className="brand-badge">PayPal Sandbox</span>
          </Link>
          <nav className="nav">
            <Link
              to="/"
              className={`nav-link ${location.pathname === '/' ? 'active' : ''}`}
            >
              Simulator
            </Link>
            <Link
              to="/log"
              className={`nav-link ${location.pathname === '/log' ? 'active' : ''}`}
            >
              Decision Log
            </Link>
          </nav>
        </div>
      </header>

      <main className="container">
        <Routes>
          <Route path="/" element={<SimulatorPage />} />
          <Route path="/result/:logId" element={<ResultPage />} />
          <Route path="/log" element={<DecisionLogPage />} />
          <Route path="/return" element={<ReturnHandler />} />
        </Routes>
      </main>
    </div>
  );
}
