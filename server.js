'use strict';

require('dotenv').config();

const express      = require('express');
const db           = require('./db');
const v1Data       = require('./routes/v1/data');
const v1Changelog  = require('./routes/v1/changelog');

const app  = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

// ── Express setup ─────────────────────────────────────────────────────────────

app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

// ── Simulation data (in-memory only, cleared on server restart) ───────────────
let simData = null;

app.get('/api/sim-data', (req, res) => {
  if (simData) res.json(simData);
  else res.status(404).json({ active: false });
});

app.post('/api/sim-data', (req, res) => {
  simData = req.body;
  res.json({ ok: true });
});

app.delete('/api/sim-data', (req, res) => {
  simData = null;
  res.json({ ok: true });
});

// ── API routes — v1 canonical + M1 backward-compatible aliases ────────────────

app.use('/api/v1/data',      v1Data);
app.use('/api/v1/changelog', v1Changelog);

app.use('/api/data',      v1Data);
app.use('/api/changelog', v1Changelog);

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  const storage = process.env.DATABASE_URL ? 'PostgreSQL' : `file (${db.DATA_FILE})`;
  console.log(`Org chart running at http://localhost:${PORT}`);
  console.log(`Storage: ${storage}`);
});
