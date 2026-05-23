import { useState } from 'react';
import './index.css';
import { SenderView } from './ui/SenderView';
import { ReceiverView } from './ui/ReceiverView';
import { useAuth } from './auth/useAuth';

type Mode = 'send' | 'receive';

export default function App() {
  const [mode, setMode] = useState<Mode>(() => window.location.hash.startsWith('#r=') ? 'receive' : 'send');
  const { user, signOut } = useAuth();

  return (
    <>
      <div className="app-bg" aria-hidden="true" />
      <div className="app-grid" aria-hidden="true" />

      <div className="app-root">
        {/* Header */}
        <header className="header">
          <div className="logo">
            <div className="logo-icon">⚡</div>
            <div>
              <div className="logo-text">QR-Beam</div>
              <div className="logo-sub">Air-gapped secure transfer</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="security-badge">E2E Encrypted</div>
            {user && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <img
                  src={user.picture}
                  alt={user.name}
                  title={user.email}
                  style={{ width: 30, height: 30, borderRadius: '50%', border: '2px solid var(--border)' }}
                />
                <button
                  onClick={signOut}
                  title="Sign out"
                  style={{
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    color: 'var(--text-muted)',
                    fontSize: 11,
                    padding: '4px 10px',
                    cursor: 'pointer',
                    fontFamily: 'var(--font-sans)',
                  }}
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
        </header>

        {/* Mode selector */}
        <div className="mode-selector" role="tablist" aria-label="Transfer mode">
          <button
            id="mode-send"
            role="tab"
            aria-selected={mode === 'send'}
            className={`mode-btn${mode === 'send' ? ' active' : ''}`}
            onClick={() => setMode('send')}
          >
            <span className="mode-icon">📤</span>
            Send File
          </button>
          <button
            id="mode-receive"
            role="tab"
            aria-selected={mode === 'receive'}
            className={`mode-btn${mode === 'receive' ? ' active' : ''}`}
            onClick={() => setMode('receive')}
          >
            <span className="mode-icon">📥</span>
            Receive File
          </button>
        </div>

        {/* Main card */}
        <main
          className="main-card"
          role="tabpanel"
          aria-labelledby={`mode-${mode}`}
        >
          {mode === 'send' ? <SenderView /> : <ReceiverView />}
        </main>

        {/* Footer security info */}
        <footer style={{
          textAlign: 'center', fontSize: 11, color: 'var(--text-muted)',
          padding: '0 24px 32px', maxWidth: 520
        }}>
          <div style={{ marginBottom: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, flexWrap: 'wrap' }}>
            {['ECDH P-256', 'AES-256-GCM', 'HKDF-SHA256', 'DTLS-SRTP', 'TLS 1.3'].map(t => (
              <span key={t} style={{
                padding: '2px 8px', border: '1px solid var(--border)',
                borderRadius: 4, fontFamily: 'var(--font-mono)', fontSize: 10,
                color: 'var(--text-muted)'
              }}>{t}</span>
            ))}
          </div>
          <div>Keys never transmitted · File never touches a server · Zero logs</div>
        </footer>
      </div>
    </>
  );
}
