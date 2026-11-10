import path from 'path';
import dotenv from 'dotenv';
dotenv.config();
dotenv.config({ path: path.join(__dirname, '../../.env') });
dotenv.config({ path: path.join(__dirname, '../.env') });
import express from 'express';
import cors from 'cors';
import { initDb } from './db/database';
import agentRoutes from './routes/agent';
import firewallRoutes from './routes/firewall';
import paypalRoutes from './routes/paypal';

const app = express();
const PORT = process.env.PORT ?? 3001;

app.use(cors());
app.use(express.json());

// Mount routes
app.use('/api/agent', agentRoutes);
app.use('/api/firewall', firewallRoutes);
app.use('/api/paypal', paypalRoutes);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

// Initialize DB then start listening when executed directly
if (require.main === module) {
  initDb().then(() => {
    app.listen(PORT, () => {
      console.log(`[server] listening on http://localhost:${PORT}`);
    });
  }).catch((err) => {
    console.error('[server] DB init failed:', err);
    process.exit(1);
  });
}

export default app;
