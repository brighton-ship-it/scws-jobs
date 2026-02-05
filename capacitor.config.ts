import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.scwellservice.tech',
  appName: 'SCWS Tech',
  webDir: 'public',
  server: {
    url: 'https://scws-jobs.vercel.app/tech',
    cleartext: true
  },
  ios: {
    contentInset: 'automatic',
    backgroundColor: '#ffffff',
    scheme: 'SCWS Tech'
  },
  android: {
    backgroundColor: '#ffffff'
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#059669',
      showSpinner: false
    }
  }
};

export default config;
