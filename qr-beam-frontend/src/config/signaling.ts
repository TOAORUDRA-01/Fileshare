export function getSignalingUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const sameOriginUrl = `${protocol}//${window.location.host}/signal`;
  const configuredUrl = import.meta.env.VITE_SIGNALING_URL?.trim();

  if (!configuredUrl) return sameOriginUrl;

  const isHttpsPage = window.location.protocol === 'https:';
  const isInsecureWs = configuredUrl.startsWith('ws://');
  const isLoopbackUrl = /^wss?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/i.test(configuredUrl);
  const isLoopbackPage = /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(window.location.hostname);

  if ((isHttpsPage && isInsecureWs) || (isLoopbackUrl && !isLoopbackPage)) {
    console.warn(
      `Ignoring VITE_SIGNALING_URL=${configuredUrl}; using same-origin signaling proxy ${sameOriginUrl}.`
    );
    return sameOriginUrl;
  }

  return configuredUrl;
}
