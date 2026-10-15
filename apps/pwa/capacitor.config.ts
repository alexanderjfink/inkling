import type { CapacitorConfig } from '@capacitor/cli'

/**
 * The Android shell.
 *
 * Deliberately thin: the app is the same React build either way, and the native layer
 * only exists for the two things a browser cannot do — a scheduled notification, and
 * the system share sheet without going through Chrome.
 *
 * Two details that matter and are easy to get wrong:
 *
 *   - `androidScheme: 'https'` makes the WebView origin `https://localhost`, which is
 *     a *secure context*. Without it `crypto.subtle` is unavailable, and the log hashes
 *     image blobs with it — capture would fail on the phone and work on the desktop.
 *   - There is no `server.url` here on purpose. The assets are bundled on the device,
 *     so `/api` would resolve to the device itself. Point it at the server in Settings,
 *     or bake it in: `VITE_INKLING_SERVER=https://you.ts.net/api bun run build`.
 */
const config: CapacitorConfig = {
  appId: 'app.inkling.mobile',
  appName: 'Inkling',
  webDir: 'dist',
  android: {
    allowMixedContent: false,
  },
  server: {
    androidScheme: 'https',
  },
}

export default config
