import { useEffect, useMemo, useRef, useState } from 'react';

const MAX_MB = 300;

const primaryBtn =
  'w-full rounded-2xl bg-gradient-to-r from-violet-500 via-fuchsia-500 to-pink-500 px-6 py-4 text-base font-bold text-white shadow-lg shadow-fuchsia-500/25 transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40';
const greenBtn =
  'flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-400 to-green-600 px-6 py-4 text-base font-bold text-white shadow-lg shadow-green-500/25 transition active:scale-[0.98]';
const ghostBtn =
  'w-full rounded-2xl border border-white/15 bg-white/5 px-6 py-4 text-center text-base font-semibold text-white transition active:scale-[0.98]';

// fetch() can't report upload progress, so uploads use XMLHttpRequest
function uploadVideo(file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload');

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let data = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* not JSON */
      }
      if (xhr.status === 200) resolve(data);
      else reject(new Error(data.error || 'Upload failed. Try again.'));
    };
    xhr.onerror = () => reject(new Error('Network error. Check your connection and try again.'));

    const form = new FormData();
    form.append('video', file);
    xhr.send(form);
  });
}

export default function App() {
  const [file, setFile] = useState(null);
  const [phase, setPhase] = useState('idle'); // idle | uploading | processing | done | error
  const [progress, setProgress] = useState(0);
  const [queuePos, setQueuePos] = useState(0);
  const [jobId, setJobId] = useState(null);
  const [message, setMessage] = useState('');
  const inputRef = useRef(null);
  const browseRef = useRef(null);

  const [number, setNumber] = useState(() => {
    try {
      return localStorage.getItem('wa-number') || '';
    } catch {
      return '';
    }
  });
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [sender, setSender] = useState(null);
  const [sendError, setSendError] = useState('');

  const previewUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => previewUrl && URL.revokeObjectURL(previewUrl), [previewUrl]);

  function pickFile(e) {
    const chosen = e.target.files?.[0];
    e.target.value = '';
    if (!chosen) return;
    if (!chosen.type.startsWith('video/')) {
      setMessage('That is not a video. Choose a video from your phone.');
      return;
    }
    if (chosen.size > MAX_MB * 1024 * 1024) {
      setMessage(`That video is over ${MAX_MB} MB. Choose a shorter clip.`);
      return;
    }
    setFile(chosen);
    setPhase('idle');
    setJobId(null);
    setMessage('');
    setSent(false);
    setSender(null);
    setSendError('');
  }

  async function start() {
    if (!file) return;
    try {
      setPhase('uploading');
      setProgress(0);
      setMessage('');

      // Copy the file into memory first. Some phones lose access to the file
      // when it is read straight from the picker, which shows up as a network error.
      let copy;
      try {
        const buffer = await file.arrayBuffer();
        copy = new File([buffer], file.name, { type: file.type });
      } catch {
        throw new Error('Your phone could not read this video. Pick it again with Browse all files.');
      }

      const { id } = await uploadVideo(copy, setProgress);
      setJobId(id);
      setPhase('processing');
    } catch (err) {
      setPhase('error');
      setMessage(err.message);
    }
  }

  // Ask the server every 2 seconds whether the video is ready
  useEffect(() => {
    if (phase !== 'processing' || !jobId) return;

    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/status/${jobId}`);
        const data = await res.json();
        if (!res.ok) {
          setPhase('error');
          setMessage(data.error || 'Something went wrong.');
        } else if (data.status === 'done') {
          setPhase('done');
        } else if (data.status === 'error') {
          setPhase('error');
          setMessage(data.error || 'Could not process this video.');
        } else {
          setQueuePos(data.position || 0);
        }
      } catch {
        /* network blip: try again on the next tick */
      }
    }, 2000);

    return () => clearInterval(timer);
  }, [phase, jobId]);

  async function sendToWhatsApp() {
    setSendError('');
    setSending(true);
    try {
      const res = await fetch(`/api/send/${jobId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ number })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not send. Try again.');

      try {
        localStorage.setItem('wa-number', number); // remember it for next time
      } catch {
        /* storage blocked: ignore */
      }
      setSender(data.sender || null);
      setSent(true);
    } catch (err) {
      setSendError(err.message);
    } finally {
      setSending(false);
    }
  }

  function startOver() {
    setFile(null);
    setPhase('idle');
    setJobId(null);
    setProgress(0);
    setMessage('');
    setSent(false);
    setSender(null);
    setSendError('');
  }

  const busy = phase === 'uploading' || phase === 'processing';
  const sizeLabel = file ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : '';

  return (
    <main className="relative min-h-screen overflow-hidden bg-neutral-950 font-sans text-neutral-100">
      {/* soft glow behind the header */}
      <div className="pointer-events-none absolute -top-24 left-1/2 h-64 w-64 -translate-x-1/2 rounded-full bg-fuchsia-600/25 blur-3xl" />
      <div className="pointer-events-none absolute top-1/2 -right-20 h-56 w-56 rounded-full bg-violet-600/15 blur-3xl" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-md flex-col px-5 py-10">
        <header className="mb-8 text-center">
          <h1 className="font-display text-4xl font-extrabold leading-tight tracking-tight">
            <span className="bg-gradient-to-r from-violet-400 via-fuchsia-400 to-pink-400 bg-clip-text text-transparent">
              Sharp Status
            </span>
          </h1>
          <p className="mx-auto mt-2 max-w-[30ch] text-sm text-neutral-400">
            Post videos to your WhatsApp status without the blur.
          </p>
        </header>

        {/* Video picker: compact card, not a big frame */}
        {!file ? (
          <button
            type="button"
            onClick={() => !busy && inputRef.current?.click()}
            disabled={busy}
            className="flex w-full flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-white/20 bg-white/5 px-6 py-9 text-center transition active:scale-[0.98] disabled:opacity-50"
            aria-label="Choose a video"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-pink-500 shadow-lg shadow-fuchsia-500/30">
              <svg
                viewBox="0 0 24 24"
                className="h-6 w-6 text-white"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 16V4m0 0L7 9m5-5 5 5" />
                <path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
              </svg>
            </span>
            <span className="text-base font-semibold">Choose a video</span>
            <span className="text-xs text-neutral-500">Tap to pick one from your phone</span>
          </button>
        ) : (
          <div className="flex items-center gap-4 rounded-2xl border border-white/10 bg-white/5 p-3">
            <video
              src={previewUrl}
              className="aspect-[9/16] w-16 shrink-0 rounded-xl bg-black object-cover"
              muted
              playsInline
              loop
              autoPlay
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{file.name}</p>
              <p className="mt-0.5 text-xs text-neutral-400">{sizeLabel}</p>
              <button
                type="button"
                onClick={() => !busy && inputRef.current?.click()}
                disabled={busy}
                className="mt-2 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-neutral-200 transition active:scale-95 disabled:opacity-40"
              >
                Change video
              </button>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={() => !busy && browseRef.current?.click()}
          disabled={busy}
          className="mx-auto mt-3 text-xs text-neutral-500 underline underline-offset-4 disabled:opacity-40"
        >
          Can't find your video? Browse all files
        </button>

        <input
          ref={inputRef}
          type="file"
          accept="video/*"
          onChange={pickFile}
          className="hidden"
        />
        <input ref={browseRef} type="file" onChange={pickFile} className="hidden" />

        <section className="mt-8" aria-live="polite">
          {phase === 'idle' && (
            <button type="button" onClick={start} disabled={!file} className={primaryBtn}>
              Make it sharp
            </button>
          )}

          {phase === 'uploading' && (
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="mb-3 text-sm font-semibold">Uploading your video: {progress}%</p>
              <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-violet-500 to-pink-500 transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          {phase === 'processing' && (
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="mb-3 text-sm font-semibold">
                {queuePos > 0
                  ? `Waiting in line. You are number ${queuePos}.`
                  : 'Sharpening your video. This can take a few minutes.'}
              </p>
              <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
                <div className="h-full w-1/2 animate-pulse rounded-full bg-gradient-to-r from-violet-500 to-pink-500" />
              </div>
              <p className="mt-3 text-xs text-neutral-500">Keep this page open.</p>
            </div>
          )}

          {phase === 'done' && (
            <div className="flex flex-col gap-3">
              {!sent ? (
                <>
                  <p className="text-lg font-bold">Your video is ready.</p>
                  <label htmlFor="wa-number" className="text-xs font-semibold text-neutral-400">
                    Your WhatsApp number
                  </label>
                  <input
                    id="wa-number"
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel"
                    placeholder="2348012345678"
                    value={number}
                    onChange={(e) => setNumber(e.target.value)}
                    className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-base text-white placeholder:text-neutral-600 focus:border-fuchsia-400 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={sendToWhatsApp}
                    disabled={sending || number.replace(/\D/g, '').length < 10}
                    className={primaryBtn}
                  >
                    {sending ? 'Sending...' : 'Send to my WhatsApp'}
                  </button>
                  {sendError && (
                    <p className="text-sm font-medium text-red-400" role="alert">
                      {sendError}
                    </p>
                  )}
                </>
              ) : (
                <>
                  <div className="rounded-2xl border border-emerald-400/30 bg-emerald-400/10 p-4">
                    <p className="mb-2 flex items-center gap-2 text-base font-bold text-emerald-300">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-400 text-sm text-neutral-950">
                        ✓
                      </span>
                      Sent to your WhatsApp
                    </p>
                    <p className="text-sm text-neutral-300">
                      Open the chat, tap and hold the video, then forward it to My status.
                    </p>
                  </div>
                  {sender && (
                    <a
                      href={`https://wa.me/${sender}`}
                      target="_blank"
                      rel="noreferrer"
                      className={greenBtn}
                    >
                      Open WhatsApp
                    </a>
                  )}
                </>
              )}

              <a href={`/api/file/${jobId}?download=1`} className={ghostBtn}>
                Download video
              </a>
              <button
                type="button"
                onClick={startOver}
                className="py-2 text-sm font-medium text-fuchsia-300 underline underline-offset-4"
              >
                Sharpen another video
              </button>
              <p className="text-center text-xs text-neutral-600">
                Your video is deleted from the server after 30 minutes.
              </p>
            </div>
          )}

          {phase === 'error' && (
            <div className="flex flex-col gap-3">
              <p className="rounded-2xl border border-red-400/30 bg-red-400/10 p-4 text-sm font-medium text-red-300">
                {message || 'Something went wrong.'}
              </p>
              <button type="button" onClick={startOver} className={primaryBtn}>
                Start over
              </button>
            </div>
          )}

          {message && phase !== 'error' && (
            <p className="mt-4 text-sm font-medium text-red-400" role="alert">
              {message}
            </p>
          )}
        </section>
      </div>
    </main>
  );
}