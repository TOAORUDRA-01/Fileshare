import { type DragEvent, useState, useRef, useEffect, useCallback } from 'react';
import { generateECDHKeyPair } from '../crypto/ecdh';
import { buildQRPayload, generateQRDataURL, generateSessionId, QR_ROTATE_MS } from '../qr/encode';
import { QRBeamPeer } from '../webrtc/peer';
import { sendFile } from '../webrtc/chunker';
import type { ChunkProgress } from '../webrtc/chunker';
import { getSignalingUrl } from '../config/signaling';

type Phase = 'idle' | 'generating' | 'showing_qr' | 'waiting_receiver' | 'connected' | 'transferring' | 'done' | 'error';

function formatBytes(b: number): string {
  if (b === 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(b) / Math.log(1024));
  return `${(b / Math.pow(1024, i)).toFixed(1)} ${u[i]}`;
}
function formatSpeed(bps: number): string {
  return formatBytes(bps) + '/s';
}
function formatEta(s: number): string {
  if (!isFinite(s)) return '—';
  if (s < 60) return `${Math.round(s)}s`;
  return `${Math.round(s / 60)}m ${Math.round(s % 60)}s`;
}

const SIGNALING_URL = getSignalingUrl();

export function SenderView() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [file, setFile] = useState<File | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [sessionIdHex, setSessionIdHex] = useState('');
  const [countdown, setCountdown] = useState(QR_ROTATE_MS / 1000);
  const [progress, setProgress] = useState<ChunkProgress | null>(null);
  const [error, setError] = useState<string>('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const peerRef = useRef<QRBeamPeer | null>(null);
  const rotateTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const cleanup = useCallback(() => {
    if (rotateTimerRef.current) clearInterval(rotateTimerRef.current);
    if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
    peerRef.current?.close();
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  const handleFile = useCallback((f: File) => {
    setFile(f);
    setPhase('idle');
    setError('');
    setProgress(null);
  }, []);

  const onDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault(); setIsDragOver(false);
    const f = e.dataTransfer?.files[0];
    if (f) handleFile(f);
  }, [handleFile]);

  const startSession = useCallback(async () => {
    if (!file) return;
    setError('');
    setPhase('generating');

    try {
      // Generate ephemeral ECDH key pair
      const keyPair = await generateECDHKeyPair();

      const sessionId = generateSessionId();
      const sidHex = Array.from(sessionId).map(b => b.toString(16).padStart(2,'0')).join('');
      setSessionIdHex(sidHex.substring(0, 16) + '…');

      // Build initial QR payload
      const payload = await buildQRPayload(keyPair.publicKeyBytes, sessionId, SIGNALING_URL);
      const dataUrl = await generateQRDataURL(payload);
      setQrDataUrl(dataUrl);
      setPhase('showing_qr');
      setCountdown(QR_ROTATE_MS / 1000);

      // Rotate QR every QR_ROTATE_MS
      let cdVal = QR_ROTATE_MS / 1000;
      countdownTimerRef.current = setInterval(() => {
        cdVal = cdVal <= 1 ? QR_ROTATE_MS / 1000 : cdVal - 1;
        setCountdown(cdVal);
      }, 1000);

      rotateTimerRef.current = setInterval(async () => {
        const p = await buildQRPayload(keyPair.publicKeyBytes, sessionId, SIGNALING_URL);
        const du = await generateQRDataURL(p);
        setQrDataUrl(du);
      }, QR_ROTATE_MS);

      // Connect to signaling server and wait for receiver
      const peer = new QRBeamPeer('sender', sidHex, {
        onChannelOpen: async (channel) => {
          if (rotateTimerRef.current) clearInterval(rotateTimerRef.current);
          if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
          setPhase('transferring');

          await sendFile(file, peer.getAESKey()!, channel, {
            onProgress: setProgress,
            onDone: () => setPhase('done'),
            onError: (err) => { setError(err.message); setPhase('error'); },
          }, {
            maxMessageSize: peer.getMaxMessageSize(),
          });
        },
        onConnectionStateChange: (state) => {
          if (state === 'connected') setPhase('connected');
          if (state === 'failed' || state === 'disconnected') {
            setError('Connection to receiver was lost.');
            setPhase('error');
          }
        },
        onError: (err) => { setError(err.message); setPhase('error'); },
      });
      peerRef.current = peer;

      await peer.connectSignaling(
        SIGNALING_URL,
        keyPair.privateKey,
        keyPair.publicKeyBytes,
        undefined,
        sessionId
      );
      setPhase('waiting_receiver');

    } catch (err: any) {
      setError(err.message ?? String(err));
      setPhase('error');
    }
  }, [file]);

  const reset = useCallback(() => {
    cleanup();
    setPhase('idle');
    setFile(null);
    setProgress(null);
    setError('');
    setQrDataUrl('');
  }, [cleanup]);

  const getFileIcon = (mimeType: string) => {
    if (mimeType.startsWith('image/')) return '🖼️';
    if (mimeType.startsWith('video/')) return '🎬';
    if (mimeType.startsWith('audio/')) return '🎵';
    if (mimeType.includes('pdf')) return '📄';
    if (mimeType.includes('zip') || mimeType.includes('archive')) return '📦';
    return '📁';
  };

  const steps = [
    { label: 'Key pair generated', done: ['showing_qr','waiting_receiver','connected','transferring','done'].includes(phase) },
    { label: 'QR displayed — waiting for scan', done: ['waiting_receiver','connected','transferring','done'].includes(phase), active: phase === 'showing_qr' },
    { label: 'Receiver connected', done: ['connected','transferring','done'].includes(phase), active: phase === 'waiting_receiver' },
    { label: 'Encrypted channel open', done: ['transferring','done'].includes(phase), active: phase === 'connected' },
    { label: 'File transfer complete', done: phase === 'done', active: phase === 'transferring' },
  ];

  return (
    <div>
      {/* File picker */}
      {(phase === 'idle' || phase === 'error') && (
        <>
          {!file ? (
            <div
              className={`dropzone${isDragOver ? ' drag-over' : ''}`}
              onDrop={onDrop}
              onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
              onDragLeave={() => setIsDragOver(false)}
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="dropzone-icon">📂</div>
              <div className="dropzone-title">Drop a file here</div>
              <div className="dropzone-sub">or click to browse — any size, any type</div>
              <div className="dropzone-hint">
                <span>🔒</span>
                <span>End-to-end encrypted · Zero server storage</span>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                style={{ display: 'none' }}
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
              />
            </div>
          ) : (
            <>
              <div className="file-chip">
                <span className="file-icon">{getFileIcon(file.type)}</span>
                <div className="file-info">
                  <div className="file-name">{file.name}</div>
                  <div className="file-meta">{formatBytes(file.size)} · {file.type || 'unknown type'}</div>
                </div>
                <button className="file-remove" onClick={() => setFile(null)}>✕</button>
              </div>
              <button className="btn btn-primary btn-full" onClick={startSession}>
                🚀 Generate Secure QR
              </button>
            </>
          )}
          {error && (
            <div className="error-banner">
              <span>⚠️</span>
              <span>{error}</span>
            </div>
          )}
        </>
      )}

      {/* Generating */}
      {phase === 'generating' && (
        <div style={{ textAlign: 'center', padding: '40px 0' }}>
          <div className="spinner" style={{ margin: '0 auto 16px', width: 36, height: 36 }} />
          <div style={{ color: 'var(--text-secondary)', fontSize: 14 }}>Generating ephemeral ECDH key pair…</div>
        </div>
      )}

      {/* QR Display + session steps */}
      {(phase === 'showing_qr' || phase === 'waiting_receiver' || phase === 'connected') && qrDataUrl && (
        <div className="qr-wrapper">
          {file && (
            <div className="file-chip" style={{ width: '100%' }}>
              <span className="file-icon">{getFileIcon(file.type)}</span>
              <div className="file-info">
                <div className="file-name">{file.name}</div>
                <div className="file-meta">{formatBytes(file.size)} · {file.type || 'unknown type'}</div>
              </div>
            </div>
          )}
          <div className="qr-frame">
            <img src={qrDataUrl} alt="Secure QR Code" width={260} height={260} />
            <div className="qr-corner tl" />
            <div className="qr-corner tr" />
            <div className="qr-corner bl" />
            <div className="qr-corner br" />
          </div>
          {phase === 'showing_qr' && (
            <div className="qr-countdown">
              <span style={{ color: 'var(--text-muted)' }}>Refreshes in</span>
              <div className="countdown-bar">
                <div className="countdown-fill" style={{ width: `${(countdown / (QR_ROTATE_MS / 1000)) * 100}%` }} />
              </div>
              <span className="qr-timer">{countdown}s</span>
            </div>
          )}
          <div className="qr-label">
            Scan with the receiver's device<br />
            <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Air-gapped key exchange · No network exposure</span>
          </div>
          <div className="qr-session-id">Session: {sessionIdHex}</div>
        </div>
      )}

      {/* Steps */}
      {(['showing_qr','waiting_receiver','connected','transferring','done'] as Phase[]).includes(phase) && (
        <>
          <div className="divider" />
          <div className="steps">
            {steps.map((s, i) => (
              <div className="step" key={i}>
                <div className={`step-num ${s.done ? 'done' : s.active ? 'active' : 'idle'}`}>
                  {s.done ? '✓' : i + 1}
                </div>
                <span className={`step-label ${s.done ? 'done' : ''}`}>{s.label}</span>
                {s.active && <div className="spinner" style={{ marginLeft: 'auto' }} />}
              </div>
            ))}
          </div>
        </>
      )}

      {/* Transfer progress */}
      {phase === 'transferring' && progress && (
        <div className="progress-section">
          <div className="progress-header">
            <span className="progress-label">Sending encrypted chunks…</span>
            <span className="progress-pct">{Math.round((progress.sentChunks / progress.totalChunks) * 100)}%</span>
          </div>
          <div className="progress-bar-bg">
            <div className="progress-bar-fill" style={{ width: `${(progress.sentChunks / progress.totalChunks) * 100}%` }} />
          </div>
          <div className="progress-stats">
            <div className="progress-stat"><span>{formatBytes(progress.bytesSent)}</span> / <span className="val">{formatBytes(progress.totalBytes)}</span></div>
            <div className="progress-stat">⚡ <span className="val">{formatSpeed(progress.speedBps)}</span></div>
            <div className="progress-stat">⏱ <span className="val">{formatEta(progress.etaSeconds)}</span></div>
          </div>
        </div>
      )}

      {/* Done */}
      {phase === 'done' && (
        <div className="success-state">
          <div className="success-icon">✅</div>
          <div className="success-title">Transfer Complete!</div>
          <div className="success-sub">File delivered securely · SHA-256 verified</div>
          <button className="btn btn-ghost" style={{ marginTop: 24 }} onClick={reset}>Send Another File</button>
        </div>
      )}
    </div>
  );
}
