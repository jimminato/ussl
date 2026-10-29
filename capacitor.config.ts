import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
  appId: 'fr.nexalink.ussl',
  appName: 'USSL',
  webDir: 'www',
  server: { url: 'https://ussl.nexalink.fr', cleartext: false, androidScheme: 'https' },
  android: { allowMixedContent: false }
};
export default config;
