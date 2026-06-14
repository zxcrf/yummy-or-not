// AMap (高德) SDK compliance gating — 高德《合规使用方案》.
//
// COMPLIANCE CONTRACT (MANDATORY):
//   - When the user has NOT consented, the SDK MUST NOT be initialized.
//   - When the user HAS consented, the SDK is initialized EXACTLY ONCE.
//
// IMPL NOTE (react-native-amap3d@3.2.4): the JS `AMapSdk` export exposes ONLY
// init(apiKey?) + getVersion(). The AMap privacy registration
// (MapsInitializer.updatePrivacyShow / updatePrivacyAgree) runs INSIDE the
// native initSDK and ONLY when a key is passed (Android `apiKey?.let { ... }`).
// There is NO JS updatePrivacyShow/updatePrivacyAgree method. Therefore privacy
// consent is registered by calling AMapSdk.init(key) WITH the key — calling
// init() with no key never registers privacy (white-screen + non-compliant).
import { AMapSdk } from 'react-native-amap3d';

// Expo inlines EXPO_PUBLIC_* into the JS bundle at build time, so this reads the
// real key in a release build. The withAmapAndroidKey plugin also writes it into
// the AndroidManifest meta-data for the native side; init(key) is what actually
// drives the native privacy registration.
let inited = false;

/**
 * Initialize the AMap SDK exactly once, but ONLY after the user has consented.
 * Passing the key to init() is what runs the native privacy registration
 * (updatePrivacyShow/updatePrivacyAgree live inside native initSDK and only fire
 * when a key is supplied). Without a key we must NOT call init.
 */
export function initAmapIfConsented(consent: boolean): void {
  // Without consent we must not initialize the SDK at all.
  if (!consent) return;
  // Guard against double-init (consent restored on mount + grant tap).
  if (inited) return;

  const key = process.env.EXPO_PUBLIC_AMAP_ANDROID_SDK_KEY;
  if (!key) {
    // No key → init() would NOT register privacy and would white-screen the map.
    // Fail loudly rather than silently shipping a dead, non-compliant map.
    console.warn(
      '[amap] EXPO_PUBLIC_AMAP_ANDROID_SDK_KEY is unset — skipping AMap init (map will not work).',
    );
    return;
  }

  // init(key) → native initSDK(key) → registers privacy (updatePrivacyShow/Agree)
  // then initializes. This is the ONLY compliant init path.
  AMapSdk.init(key);
  inited = true;
}
