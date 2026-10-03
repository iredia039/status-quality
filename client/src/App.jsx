import { useEffect, useMemo, useRef, useState } from 'react';

const MAX_MB = 300;

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
    setSendError('');
  }

  const busy = phase === 'uploading' || phase === 'processing';

  // classes used in a few places, kept here so I don't repeat them
  const focusRing = 'focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-lilac';
  const gradientBtn = 'bg-gradient-to-r from-coral to-violet text-white';

  return (
    <main className="min-h-screen bg-void font-sans text-soft">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-5 py-8">
        <header className="mb-8">
          <h1 className="font-display text-4xl font-extrabold leading-[1.05] tracking-tight">
            Post your video without the blur.
          </h1>
          <p className="mt-3 max-w-[34ch] text-base text-soft/60">
            Pick a video, wait for it to finish, then send it to your WhatsApp.
          </p>
        </header>

        {/* The 9:16 frame is the size of a WhatsApp status. It gets the glow, everything else stays quiet */}
        <div className="relative mx-auto w-full max-w-[260px]">
          {/* blurred gradient behind the frame = the glow */}
          <div
            className={`absolute -inset-2 rounded-[2.5rem] bg-gradient-to-br from-coral to-violet blur-2xl transition-opacity ${
              busy ? 'animate-pulse opacity-50' : 'opacity-30'
            }`}
            aria-hidden="true"
          />
          {/* thin gradient border */}
          <div className="relative rounded-[2.1rem] bg-gradient-to-br from-coral via-violet to-violet p-[2px]">
            <button
              type="button"
              onClick={() => !busy && inputRef.current?.click()}
              disabled={busy}
              className={`block aspect-[9/16] w-full overflow-hidden rounded-[2rem] bg-panel disabled:cursor-not-allowed ${focusRing}`}
              aria-label={file ? 'Choose a different video' : 'Choose a video'}
            >
              {previewUrl ? (
                <video
                  src={previewUrl}
                  className="h-full w-full object-cover"
                  muted
                  playsInline
                  loop
                  autoPlay
                />
              ) : (
                <span className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
                  <span className="font-display text-2xl font-extrabold">Tap to choose a video</span>
                  <span className="text-sm text-soft/50">From your gallery</span>
                </span>
              )}
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={() => !busy && browseRef.current?.click()}
          disabled={busy}
          className="mx-auto mt-6 text-base font-medium text-lilac underline underline-offset-4 disabled:opacity-40"
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
            <button
              type="button"
              onClick={start}
              disabled={!file}
              className={`w-full rounded-2xl ${gradientBtn} px-6 py-4 text-lg font-bold shadow-lg shadow-violet/20 transition active:scale-[0.98] disabled:bg-none disabled:bg-panel disabled:text-soft/30 disabled:shadow-none ${focusRing}`}
            >
              Make it sharp
            </button>
          )}

          {phase === 'uploading' && (
            <div>
              <p className="mb-2 font-bold">Uploading your video: {progress}%</p>
              <div className="h-3 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-coral to-violet transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          {phase === 'processing' && (
            <div>
              <p className="mb-2 font-bold">
                {queuePos > 0
                  ? `Waiting in line. You are number ${queuePos}.`
                  : 'Sharpening your video. This can take a few minutes.'}
              </p>
              <div className="h-3 w-full overflow-hidden rounded-full bg-white/10">
                <div className="h-full w-1/2 animate-pulse rounded-full bg-gradient-to-r from-coral to-violet" />
              </div>
              <p className="mt-3 text-sm text-soft/50">Keep this page open.</p>
            </div>
          )}

          {phase === 'done' && (
            <div className="flex flex-col gap-3">
              <p className="font-display text-2xl font-extrabold">Your video is ready.</p>

              {!sent ? (
                <>
                  <label htmlFor="wa-number" className="text-sm font-bold">
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
                    className={`w-full rounded-2xl border border-line bg-panel px-4 py-4 text-lg text-soft placeholder:text-soft/30 ${focusRing}`}
                  />
                  <button
                    type="button"
                    onClick={sendToWhatsApp}
                    disabled={sending || number.replace(/\D/g, '').length < 10}
                    className={`w-full rounded-2xl ${gradientBtn} px-6 py-4 text-lg font-bold shadow-lg shadow-violet/20 transition active:scale-[0.98] disabled:opacity-40 ${focusRing}`}
                  >
                    {sending ? 'Sending...' : 'Send to my WhatsApp'}
                  </button>
                  {sendError && (
                    <p className="font-medium text-red-400" role="alert">
                      {sendError}
                    </p>
                  )}
                </>
              ) : (
                <div className="rounded-2xl border border-line bg-panel p-4">
                  <p className="mb-2 font-bold">Sent! Now open WhatsApp:</p>
                  <ol className="list-decimal space-y-1 pl-5 text-base text-soft/80">
                    <li>Open the new chat with your video.</li>
                    <li>Tap and hold the video, then forward it to My status.</li>
                  </ol>
                </div>
              )}

              <a
                href={`/api/file/${jobId}?download=1`}
                className={`w-full rounded-2xl border border-line bg-panel px-6 py-4 text-center text-lg font-bold transition active:scale-[0.98] ${focusRing}`}
              >
                Download video
              </a>
              <button
                type="button"
                onClick={startOver}
                className="py-2 text-base font-medium text-lilac underline underline-offset-4"
              >
                Sharpen another video
              </button>
              <p className="text-sm text-soft/50">
                Your video is deleted from the server after 30 minutes.
              </p>
            </div>
          )}

          {phase === 'error' && (
            <div className="flex flex-col gap-3">
              <p className="font-bold text-red-400">{message || 'Something went wrong.'}</p>
              <button
                type="button"
                onClick={startOver}
                className={`w-full rounded-2xl border border-line bg-panel px-6 py-4 text-lg font-bold ${focusRing}`}
              >
                Start over
              </button>
            </div>
          )}

          {message && phase !== 'error' && (
            <p className="mt-4 font-medium text-red-400" role="alert">
              {message}
            </p>
          )}
        </section>
      </div>
    </main>
  );
}