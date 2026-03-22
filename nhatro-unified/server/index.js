const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const dataDir = path.join(__dirname, 'data');
const statePath = path.join(dataDir, 'state.json');
const stateTmpPath = path.join(dataDir, 'state.json.tmp');

function ensureDataDir() {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
  }
}

function loadAppState() {
  try {
    const raw = fs.readFileSync(statePath, 'utf8');
    if (!raw.trim()) return null;
    return JSON.parse(raw);
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    return null;
  }
}

function saveAppState(state) {
  ensureDataDir();
  const now = new Date().toISOString();
  const payload = JSON.stringify(state, null, 2);
  fs.writeFileSync(stateTmpPath, payload, 'utf8');
  fs.renameSync(stateTmpPath, statePath);
  return { updatedAt: now };
}

app.get('/api/state', (req, res) => {
  const value = loadAppState();
  if (!value) {
    return res.status(404).json({ error: 'No state found' });
  }
  res.json({ state: value });
});

app.post('/api/state', (req, res) => {
  const { state } = req.body;
  if (!state || typeof state !== 'object') {
    return res.status(400).json({ error: 'Invalid state payload' });
  }
  const result = saveAppState(state);
  res.json({ ok: true, ...result });
});

const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`Nhatro unified server running on http://localhost:${port}`);
  console.log(`State file: ${statePath}`);
});
