const express = require('express');
const multer = require('multer');
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { startWhatsApp, resolveNumber, sendVideoAsDocument, getSenderNumber } = require('./wa');

const PORT = process.env.PORT || 3001;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const OUTPUT_DIR = path.join(__dirname, 'processed');
const MAX_MB = 300; // largest upload allowed
const KEEP_MINUTES = 30; // processed files are deleted after this long

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const app = express();

// ---------- Job store and queue ----------
// jobs: id -> { status, input, output, error, createdAt }
// status: queued | processing | done | error
const jobs = new Map();
const queue = [];
let busy = false;

const ID_PATTERN = /^[0-9a-f-]{36}$/;

function probeBitrate(input) {
  return new Promise((resolve) => {
    const p = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=bit_rate',
      '-of', 'default=nw=1:nk=1',
      input
    ]);
    let out = '';
    p.stdout.on('data', (chunk) => (out += chunk));
    p.on('error', () => resolve(null)); // ffprobe missing: fall back to a default
    p.on('close', () => {
      const n = parseInt(out.trim(), 10);
      resolve(Number.isFinite(n) ? n : null);
    });
  });
}

async function runFfmpeg(input, output) {
  const inputBitrate = await probeBitrate(input);
  // Never bigger than the original (within limits): floor 1.2 Mbps, ceiling 3 Mbps
  const cap = Math.min(Math.max(inputBitrate || 2500000, 1200000), 3000000);

  const args = [
    '-i', input,
    '-vf', 'scale=720:1280:force_original_aspect_ratio=decrease:flags=lanczos,unsharp=5:5:0.8:5:5:0.0,pad=720:1280:(ow-iw)/2:(oh-ih)/2',
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '22',
    '-maxrate', String(cap),
    '-bufsize', String(cap * 2),
    '-profile:v', 'high',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-movflags', '+faststart',
    '-y',
    output
  ];

  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', args);
    let errorTail = '';
    ff.stderr.on('data', (chunk) => {
      errorTail = (errorTail + chunk.toString()).slice(-2000);
    });
    ff.on('error', (err) => reject(err)); // e.g. ffmpeg is not installed
    ff.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}\n${errorTail}`));
    });
  });
}

async function processNext() {
  if (busy) return;
  const id = queue.shift();
  if (!id) return;

  const job = jobs.get(id);
  if (!job) return processNext();

  busy = true;
  job.status = 'processing';
  try {
    await runFfmpeg(job.input, job.output);
    job.status = 'done';
    console.log('Done:', id);
  } catch (err) {
    console.error('Processing failed:', err.message);
    job.status = 'error';
    job.error = 'Could not process this video. Try a different file.';
  } finally {
    fs.unlink(job.input, () => {});
    busy = false;
    processNext();
  }
}

// ---------- Upload ----------
const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: MAX_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith('video/')) cb(null, true);
    else cb(new Error('Only video files are allowed.'));
  }
});

app.post('/api/upload', (req, res) => {
  upload.single('video')(req, res, (err) => {
    if (err) {
      const message =
        err.code === 'LIMIT_FILE_SIZE'
          ? `That file is over ${MAX_MB} MB.`
          : err.message;
      return res.status(400).json({ error: message });
    }
    if (!req.file) return res.status(400).json({ error: 'No video received.' });

    const id = crypto.randomUUID();
    jobs.set(id, {
      status: 'queued',
      input: req.file.path,
      output: path.join(OUTPUT_DIR, `${id}.mp4`),
      error: null,
      createdAt: Date.now()
    });
    queue.push(id);
    processNext();

    res.json({ id });
  });
});

// ---------- Status ----------
app.get('/api/status/:id', (req, res) => {
  const { id } = req.params;
  const job = ID_PATTERN.test(id) ? jobs.get(id) : null;
  if (!job) return res.status(404).json({ error: 'This video has expired. Upload it again.' });

  const position = queue.indexOf(id) + 1; // 0 if not waiting
  res.json({ status: job.status, position, error: job.error });
});

// ---------- File (stream to the page, or download) ----------
app.get('/api/file/:id', (req, res) => {
  const { id } = req.params;
  const job = ID_PATTERN.test(id) ? jobs.get(id) : null;
  if (!job || job.status !== 'done') {
    return res.status(404).json({ error: 'File not ready.' });
  }
  if (req.query.download) {
    return res.download(job.output, 'status-ready.mp4');
  }
  res.type('video/mp4').sendFile(job.output);
});


// ---------- Send to the user's own WhatsApp ----------
app.use(express.json());

const sendLog = new Map(); // ip -> [timestamps]
const MAX_SENDS_PER_HOUR = 5;

function normalizeNumber(raw) {
  let digits = String(raw || '').replace(/\D/g, '');
  if (digits.startsWith('0') && digits.length === 11) digits = '234' + digits.slice(1);
  return digits.length >= 10 && digits.length <= 15 ? digits : null;
}

app.post('/api/send/:id', async (req, res) => {
  const { id } = req.params;
  const job = ID_PATTERN.test(id) ? jobs.get(id) : null;
  if (!job || job.status !== 'done') {
    return res.status(404).json({ error: 'Video not ready or expired. Upload it again.' });
  }

  const number = normalizeNumber(req.body?.number);
  if (!number) {
    return res.status(400).json({ error: 'Enter a valid number with country code, e.g. 2348012345678.' });
  }

  const now = Date.now();
  const recent = (sendLog.get(req.ip) || []).filter((t) => now - t < 60 * 60 * 1000);
  if (recent.length >= MAX_SENDS_PER_HOUR) {
    return res.status(429).json({ error: 'Too many sends. Try again in an hour.' });
  }

  try {
    const jid = await resolveNumber(number);
    if (!jid) return res.status(404).json({ error: 'That number is not on WhatsApp.' });

    await sendVideoAsDocument(jid, job.output);
    sendLog.set(req.ip, [...recent, now]);
res.json({ ok: true, sender: getSenderNumber() });
  } catch (err) {
    console.error('Send failed:', err.message);
    res.status(500).json({ error: 'Could not send right now. Try again shortly.' });
  }
});

// ---------- Cleanup ----------
setInterval(() => {
  const cutoff = Date.now() - KEEP_MINUTES * 60 * 1000;
  for (const [id, job] of jobs) {
    if (job.createdAt < cutoff && job.status !== 'processing') {
      fs.unlink(job.output, () => {});
      fs.unlink(job.input, () => {});
      const queued = queue.indexOf(id);
      if (queued !== -1) queue.splice(queued, 1);
      jobs.delete(id);
    }
  }
}, 5 * 60 * 1000);

// ---------- Serve the built website (after `npm run build` in client) ----------
const dist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(dist)) app.use(express.static(dist));

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  startWhatsApp().catch((err) => console.error('WhatsApp failed to start:', err.message));
});