import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.curtainsaas.app',
  appName: 'Curtain Saas',
  webDir: 'dist',
  ios: {
    contentInset: 'automatic',
    scrollEnabled: true,
  },
  plugins: {
    Keyboard: {
      resize: 'body',
      style: 'light',
      resizeOnFullScreen: true,
    },
    StatusBar: {
      style: 'dark',
      backgroundColor: '#ffffff',
      overlaysWebView: false,
    },
    SplashScreen: {
      launchAutoHide: false,
      launchShowDuration: 800,
      backgroundColor: '#ffffff',
      showSpinner: false,
    },
    LocalNotifications: {
      smallIcon: 'ic_stat_icon_config_sample',
      iconColor: '#0ea5e9',
      sound: 'beep.wav',
    },
  },
};

export default config;
