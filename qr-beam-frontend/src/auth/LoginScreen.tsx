import { GoogleLogin } from '@react-oauth/google';

interface LoginScreenProps {
  onSuccess: (credential: string) => void;
  unauthorizedEmail: string | null;
}

export function LoginScreen({ onSuccess, unauthorizedEmail }: LoginScreenProps) {
  return (
    <div style={styles.root}>
      {/* Ambient background — same as main app */}
      <div className="app-bg" aria-hidden="true" />
      <div className="app-grid" aria-hidden="true" />

      <div style={styles.card}>
        {/* Logo */}
        <div style={styles.logoRow}>
          <div style={styles.logoIcon}>⚡</div>
          <div>
            <div style={styles.logoText}>QR-Beam</div>
            <div style={styles.logoSub}>Air-gapped secure transfer</div>
          </div>
        </div>

        {/* Divider */}
        <div style={styles.divider} />

        {/* Lock icon + headline */}
        <div style={styles.lockIcon}>🔐</div>
        <h1 style={styles.title}>Private Access Only</h1>
        <p style={styles.subtitle}>
          This service is restricted to authorized users.<br />
          Sign in with your Google account to continue.
        </p>

        {/* Unauthorized error */}
        {unauthorizedEmail && (
          <div style={styles.errorBox}>
            <span style={{ fontSize: 16 }}>🚫</span>
            <div>
              <div style={{ fontWeight: 600, marginBottom: 2 }}>Access Denied</div>
              <div style={{ fontSize: 12, opacity: 0.85 }}>
                <strong>{unauthorizedEmail}</strong> is not authorized to use this service.
              </div>
            </div>
          </div>
        )}

        {/* Google Sign-In button */}
        <div style={styles.buttonWrapper}>
          <GoogleLogin
            onSuccess={(response) => {
              if (response.credential) onSuccess(response.credential);
            }}
            onError={() => {
              console.error('Google Sign-In failed');
            }}
            theme="filled_black"
            shape="pill"
            size="large"
            text="signin_with"
            logo_alignment="center"
          />
        </div>

        {/* Security footer */}
        <div style={styles.footer}>
          <div style={styles.footerRow}>
            {['ECDH P-256', 'AES-256-GCM', 'Zero Logs'].map((t) => (
              <span key={t} style={styles.badge}>{t}</span>
            ))}
          </div>
          <div style={{ marginTop: 8 }}>
            Files never touch a server · Keys never transmitted
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Inline styles (scoped to login screen only) ─────────────────── */
const styles: Record<string, React.CSSProperties> = {
  root: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px 16px',
    position: 'relative',
  },
  card: {
    position: 'relative',
    zIndex: 1,
    width: '100%',
    maxWidth: 420,
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 20,
    padding: '36px 32px',
    backdropFilter: 'blur(24px)',
    boxShadow: '0 32px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04) inset',
    textAlign: 'center',
  },
  logoRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    marginBottom: 20,
  },
  logoIcon: {
    width: 40,
    height: 40,
    background: 'var(--accent-gradient)',
    borderRadius: 10,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 20,
    boxShadow: '0 4px 16px rgba(99,102,241,0.4)',
  },
  logoText: {
    fontSize: 20,
    fontWeight: 700,
    color: 'var(--text-primary)',
    letterSpacing: '-0.3px',
    textAlign: 'left',
  },
  logoSub: {
    fontSize: 11,
    color: 'var(--text-muted)',
    textAlign: 'left',
  },
  divider: {
    height: 1,
    background: 'var(--border)',
    margin: '0 0 24px',
  },
  lockIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: 700,
    color: 'var(--text-primary)',
    margin: '0 0 10px',
    letterSpacing: '-0.4px',
  },
  subtitle: {
    fontSize: 13,
    color: 'var(--text-muted)',
    lineHeight: 1.7,
    margin: '0 0 24px',
  },
  errorBox: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    background: 'rgba(239,68,68,0.12)',
    border: '1px solid rgba(239,68,68,0.35)',
    borderRadius: 10,
    padding: '12px 14px',
    marginBottom: 20,
    textAlign: 'left',
    color: '#fca5a5',
    fontSize: 13,
  },
  buttonWrapper: {
    display: 'flex',
    justifyContent: 'center',
    marginBottom: 28,
  },
  footer: {
    fontSize: 11,
    color: 'var(--text-muted)',
    lineHeight: 1.6,
    borderTop: '1px solid var(--border)',
    paddingTop: 16,
    marginTop: 4,
  },
  footerRow: {
    display: 'flex',
    justifyContent: 'center',
    gap: 8,
    flexWrap: 'wrap',
    marginBottom: 4,
  },
  badge: {
    padding: '2px 8px',
    border: '1px solid var(--border)',
    borderRadius: 4,
    fontFamily: 'var(--font-mono)',
    fontSize: 10,
    color: 'var(--text-muted)',
  },
};
