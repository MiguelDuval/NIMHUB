import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.miguelduval.nimhub',
  appName: 'NIM Hub',
  webDir: 'dist',
  server: {
    hostname: 'localhost',
    androidScheme: 'https',
    // Personal gateway deployments commonly run HTTP on a trusted LAN.
    // HTTPS is preferred for hardened deployments.
    cleartext: true,
  },
  android: {
    // Required when the secure localhost WebView calls a personal HTTP gateway.
    allowMixedContent: true,
  },
  plugins: {
    // Route fetch/XHR through Capacitor's native HTTP implementation on Android.
    // This lets the APK call hosted NVIDIA APIs without browser CORS restrictions.
    CapacitorHttp: {
      enabled: true,
    },
  },
};

export default config;
