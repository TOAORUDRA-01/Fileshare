import { useState, useRef, useCallback, useEffect } from 'react';
import { generateECDHKeyPair } from '../crypto/ecdh';
import { startQRScanner } from '../qr/decode';
import type { ParsedQRPayload } from '../qr/decode';
import { QRBeamPeer } from '../webrtc/peer';
import { startReassembler } from '../webrtc/reassembler';
import type { FileMetadata } from '../webrtc/protocol';

type Phase = 'idle' | 'scanning' | 'verifying' | 'connecting' | 'consent' | 'receiving' | 'done' | 'error';

function formatBytes(b: number): string {
  if (b === 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(b) / Math.log(1024));
  return `${(b / Math.pow(1024, i)).toFixed(1)} ${u[i]}`;
}

const SIGNALING_URL = import.meta.env.VITE_SIGNALING_URL || 'ws://localhost:8443';

export function ReceiverView() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string>('');
  const [pendingMeta, setPendingMeta] = useState<FileMetadata | null>(null);
  const [progress, setProgress] = useState({ received: 0, total: 0 });
  const [doneFile, setDoneFile] = useState<{ name: string; type: string } | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const stopScannerRef = useRef<(() => void) | null>(null);
  const peerRef = useRef<QRBeamPeer | null>(null);
  const consentResolveRef = useRef<((accept: boolean) => void) | null>(null);

  const cleanup = useCallback(() => {
    stopScannerRef.current?.();
    peerRef.current?.close();
  }, []);

  const handleScanResult = useCallback(async (payload: ParsedQRPayload) => {
    stopScannerRef.current?.();
    setPhase('verifying');

    try {
      // Generate receiver's ephemeral ECDH key pair
      const myKeyPair = await generateECDHKeyPair();
      setPhase('connecting');

      const sidHex = Array.from(payload.sessionId).map(b => b.toString(16).padStart(2,'0')).join('');

      const peer = new QRBeamPeer('receiver', sidHex, {
        onChannelOpen: (channel) => {
          startReassembler(channel, peer.getAESKey()!, {
            onMetadata: async (meta) => {
              setPendingMeta(meta);
              setPhase('consent');
              return new Promise<boolean>((resolve) => {
                consentResolveRef.current = resolve;
              });
            },
            onProgress: (received, total) => {
              setPhase('receiving');
              setProgress({ received, total });
            },
            onDone: (filename, mimeType) => {
              setDoneFile({ name: filename, type: mimeType });
              setPhase('done');
            },
            onError: (err) => {
              setError(err.message);
              setPhase('error');
            },
          });
        },
        onConnectionStateChange: (state) => {
          if (state === 'failed') { setError('Connection failed. Try scanning again.'); setPhase('error'); }
        },
        onError: (err) => { setError(err.message); setPhase('error'); },
      });
      peerRef.current = peer;

      await peer.connectSignaling(
        payload.signalingUrl || SIGNALING_URL,
        myKeyPair.privateKey,
        myKeyPair.publicKeyBytes,
        payload.senderPubKey,
        payload.sessionId
      );

    } catch (err: any) {
      setError(err.message ?? String(err));
      setPhase('error');
    }
  }, []);

  // Intercept payload from URL hash (if scanned via built-in phone camera)
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.startsWith('#r=')) {
      const b64 = hash.substring(3).replace(/-/g, '+').replace(/_/g, '/');
      try {
        const binString = atob(b64);
        const bytes = new Uint8Array(binString.length);
        for (let i = 0; i < binString.length; i++) {
          bytes[i] = binString.charCodeAt(i);
        }
        
        import('../qr/decode').then(({ parseAndVerifyPayload }) => {
          parseAndVerifyPayload(bytes)
            .then(payload => {
              handleScanResult(payload);
              window.location.hash = ''; // clear hash
            })
            .catch(err => {
              setError(err.message || 'Invalid or expired QR link.');
              setPhase('error');
            });
        });
      } catch {
        setError('Malformed QR link.');
        setPhase('error');
      }
    }
  }, [handleScanResult]);

  const startScanning = useCallback(async () => {
    setPhase('scanning');
    setError('');
    if (!videoRef.current) return;

    const stopFn = await startQRScanner(
      videoRef.current,
      handleScanResult,
      (err) => { setError(err.message); setPhase('error'); }
    );
    stopScannerRef.current = stopFn;
  }, [handleScanResult]);

  const handleConsent = useCallback((accept: boolean) => {
    consentResolveRef.current?.(accept);
    if (!accept) { setPhase('idle'); setPendingMeta(null); }
  }, []);

  const reset = useCallback(() => {
    cleanup();
    setPhase('idle');
    setError('');
    setPendingMeta(null);
    setProgress({ received: 0, total: 0 });
    setDoneFile(null);
  }, [cleanup]);

  const pct = progress.total > 0 ? Math.round((progress.received / progress.total) * 100) : 0;

  return (
    <div>
      {/* Idle — start scan */}
      {phase === 'idle' && (
        <div style={{ textAlign: 'center', padding: '32px 0' }}>
          <div style={{ fontSize: 56, marginBottom: 16 }}>📱</div>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Ready to Receive</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 28, lineHeight: 1.6 }}>
            Point your camera at the sender's QR code.<br />
            Your encryption key will be derived from the scan.
          </div>
          <button className="btn btn-primary" onClick={startScanning}>
            📷 Start Camera Scanner
          </button>
          {error && (
            <div className="error-banner" style={{ marginTop: 20, textAlign: 'left' }}>
              <span>⚠️</span><span>{error}</span>
            </div>
          )}
        </div>
      )}

      {/* Scanning */}
      {phase === 'scanning' && (
        <div>
          <div className="scanner-wrapper">
            <video ref={videoRef} className="scanner-video" autoPlay playsInline muted />
            <div className="scanner-overlay">
              <div className="scanner-frame">
                <div className="scan-line" />
              </div>
            </div>
            <div className="scanner-tip">Hold steady · Auto-detects QR-Beam codes</div>
          </div>
          <div style={{ marginTop: 16, textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>
            🔒 HMAC-SHA256 verified · Replay-protected (15s window)
          </div>
        </div>
      )}

      {/* Verifying */}
      {phase === 'verifying' && (
        <div style={{ textAlign: 'center', padding: '40px 0' }}>
          <div className="spinner" style={{ margin: '0 auto 16px', width: 36, height: 36 }} />
          <div style={{ color: 'var(--text-secondary)', fontSize: 14 }}>Verifying QR payload…</div>
          <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 6 }}>Checking HMAC signature and timestamp</div>
        </div>
      )}

      {/* Connecting */}
      {phase === 'connecting' && (
        <div style={{ textAlign: 'center', padding: '40px 0' }}>
          <div className="spinner" style={{ margin: '0 auto 16px', width: 36, height: 36 }} />
          <div style={{ color: 'var(--text-secondary)', fontSize: 14 }}>Establishing secure channel…</div>
          <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 6 }}>ECDH key derivation → WebRTC handshake</div>
        </div>
      )}

      {/* Consent modal rendered inline */}
      {phase === 'consent' && pendingMeta && (
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 20, color: 'var(--text-primary)' }}>
            📩 Incoming File Transfer
          </div>
          <div className="modal-file-info">
            {[
              ['Filename', pendingMeta.filename],
              ['Size', formatBytes(pendingMeta.size)],
              ['Type', pendingMeta.mimeType],
              ['Chunks', `${pendingMeta.totalChunks}`],
              ['Integrity', pendingMeta.sha256 ? pendingMeta.sha256.substring(0, 16) + '...' : 'AES-GCM per chunk'],
            ].map(([label, val]) => (
              <div className="row" key={label}>
                <span className="label">{label}</span>
                <span className="val">{val}</span>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 20, lineHeight: 1.6 }}>
            🔐 This file is encrypted and authenticated with AES-256-GCM per chunk.
          </div>
          <div className="modal-actions">
            <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => handleConsent(true)}>
              ✅ Accept
            </button>
            <button className="btn btn-danger" onClick={() => handleConsent(false)}>
              ✕ Reject
            </button>
          </div>
        </div>
      )}

      {/* Receiving progress */}
      {phase === 'receiving' && (
        <div>
          <div style={{ textAlign: 'center', marginBottom: 20 }}>
            <div style={{ fontSize: 36 }}>📥</div>
            <div style={{ fontSize: 15, fontWeight: 600, marginTop: 8 }}>Receiving File…</div>
          </div>
          <div className="progress-section">
            <div className="progress-header">
              <span className="progress-label">Decrypting chunks</span>
              <span className="progress-pct">{pct}%</span>
            </div>
            <div className="progress-bar-bg">
              <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
            </div>
            <div className="progress-stats">
              <div className="progress-stat">
                <span>{progress.received}</span> / <span className="val">{progress.total} chunks</span>
              </div>
            </div>
          </div>
          <div style={{ marginTop: 16, fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <div className="dot dot-active" />
            AES-256-GCM - Fast receive buffer
          </div>
        </div>
      )}

      {/* Done */}
      {phase === 'done' && doneFile && (
        <div className="success-state">
          <div className="success-icon">🎉</div>
          <div className="success-title">File Received!</div>
          <div className="success-sub">{doneFile.name}</div>
          <div className="hash-display" style={{ marginTop: 16 }}>
            <div className="label">AES-GCM verified - File integrity confirmed</div>
          </div>
          <button className="btn btn-ghost" style={{ marginTop: 24 }} onClick={reset}>Receive Another</button>
        </div>
      )}

      {/* Error */}
      {phase === 'error' && (
        <div style={{ textAlign: 'center', padding: '32px 0' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>⚠️</div>
          <div className="error-banner" style={{ textAlign: 'left' }}>
            <span>❌</span><span>{error}</span>
          </div>
          <button className="btn btn-ghost" style={{ marginTop: 20 }} onClick={reset}>Try Again</button>
        </div>
      )}
    </div>
  );
}

