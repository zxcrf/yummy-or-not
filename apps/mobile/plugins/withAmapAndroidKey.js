// Expo config plugin: inject the AMap (高德) Android SDK key meta-data and the
// ACCESS_NETWORK_STATE permission into AndroidManifest.xml. Idempotent — safe to
// re-run across expo prebuild regenerations.
const { withAndroidManifest } = require('@expo/config-plugins');

const META_NAME = 'com.amap.api.v2.apikey';
const NETWORK_STATE_PERMISSION = 'android.permission.ACCESS_NETWORK_STATE';
const PLACEHOLDER = 'AMAP_ANDROID_SDK_KEY_PLACEHOLDER';

/** @param {import('@expo/config-plugins').ExportedConfig} config */
const withAmapAndroidKey = (config) => {
  return withAndroidManifest(config, (cfg) => {
    // Prefer EXPO_PUBLIC_AMAP_ANDROID_SDK_KEY so the var name is consistent
    // end-to-end (the JS bundle inlines the same EXPO_PUBLIC_* var at build time);
    // fall back to the legacy AMAP_ANDROID_SDK_KEY env if present.
    const key =
      process.env.EXPO_PUBLIC_AMAP_ANDROID_SDK_KEY ||
      process.env.AMAP_ANDROID_SDK_KEY ||
      (cfg.extra && cfg.extra.amapAndroidSdkKey) ||
      PLACEHOLDER;

    if (key === PLACEHOLDER) {
      // Keep the placeholder fallback (key not provisioned yet) but flag it
      // LOUDLY so a release build doesn't silently ship a dead map. Not fatal.
      console.warn(
        '[withAmapAndroidKey] AMap Android SDK key not set ' +
          '(EXPO_PUBLIC_AMAP_ANDROID_SDK_KEY / AMAP_ANDROID_SDK_KEY) — using a ' +
          'placeholder. The map WILL NOT WORK in this build.',
      );
    }

    const manifest = cfg.modResults.manifest;

    // --- uses-permission: ACCESS_NETWORK_STATE (idempotent) ---
    manifest['uses-permission'] = manifest['uses-permission'] || [];
    const hasNetworkState = manifest['uses-permission'].some(
      (p) => p.$ && p.$['android:name'] === NETWORK_STATE_PERMISSION,
    );
    if (!hasNetworkState) {
      manifest['uses-permission'].push({
        $: { 'android:name': NETWORK_STATE_PERMISSION },
      });
    }

    // --- application meta-data: AMap api key (idempotent replace) ---
    const application =
      manifest.application && manifest.application[0]
        ? manifest.application[0]
        : null;
    if (!application) return cfg;

    application['meta-data'] = application['meta-data'] || [];
    const existing = application['meta-data'].find(
      (m) => m.$ && m.$['android:name'] === META_NAME,
    );
    if (existing) {
      existing.$['android:value'] = key;
    } else {
      application['meta-data'].push({
        $: { 'android:name': META_NAME, 'android:value': key },
      });
    }

    return cfg;
  });
};

module.exports = withAmapAndroidKey;
