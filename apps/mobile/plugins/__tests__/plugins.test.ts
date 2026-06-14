// Validates the config plugins' contents transforms + idempotency.
let gradleFn: (c: any) => any;
let manifestFn: (c: any) => any;
jest.mock('@expo/config-plugins', () => ({
  withAppBuildGradle: (config: any, fn: (c: any) => any) => {
    gradleFn = fn;
    return config;
  },
  withAndroidManifest: (config: any, fn: (c: any) => any) => {
    manifestFn = fn;
    return config;
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const withRelease = require('../withReleaseSigning');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const withKey = require('../withAmapAndroidKey');

test('release signing: idempotent + ternary wiring + exact gradle prop names', () => {
  withRelease({});
  const gradle = `
android {
    signingConfigs {
        debug { storeFile file('debug.keystore') }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.debug
            minifyEnabled false
        }
    }
}`;
  const out = gradleFn({ modResults: { contents: gradle } }).modResults.contents;
  const out2 = gradleFn({ modResults: { contents: out } }).modResults.contents;
  expect((out2.match(/yonRelease \{/g) || []).length).toBe(1);
  expect(out2).toContain('? signingConfigs.yonRelease : signingConfigs.debug');
  expect(out2).toContain("project.hasProperty('YON_RELEASE_STORE_FILE')");
  expect(out2).toContain('storeFile file(YON_RELEASE_STORE_FILE)');
  expect(out2).toContain('keyAlias YON_RELEASE_KEY_ALIAS');
  expect(out2).toContain('storePassword YON_RELEASE_STORE_PASSWORD');
  expect(out2).toContain('keyPassword YON_RELEASE_KEY_PASSWORD');
});

test('amap key: idempotent meta-data + ACCESS_NETWORK_STATE, env key wins', () => {
  process.env.AMAP_ANDROID_SDK_KEY = 'TESTKEY123';
  withKey({});
  const manifest = {
    manifest: {
      'uses-permission': [
        { $: { 'android:name': 'android.permission.ACCESS_FINE_LOCATION' } },
      ],
      application: [{ 'meta-data': [] }],
    },
  };
  const m = manifestFn({ modResults: manifest, extra: {} }).modResults.manifest;
  const m2 = manifestFn({ modResults: { manifest: m }, extra: {} }).modResults
    .manifest;
  const md = m2.application[0]['meta-data'].filter(
    (x: any) => x.$['android:name'] === 'com.amap.api.v2.apikey',
  );
  const ns = m2['uses-permission'].filter(
    (x: any) => x.$['android:name'] === 'android.permission.ACCESS_NETWORK_STATE',
  );
  expect(md.length).toBe(1);
  expect(md[0].$['android:value']).toBe('TESTKEY123');
  expect(ns.length).toBe(1);
});
