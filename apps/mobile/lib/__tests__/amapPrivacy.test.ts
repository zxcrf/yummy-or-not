// Tests for apps/mobile/lib/amapPrivacy.ts against the REAL react-native-amap3d
// surface (AMapSdk = { init(apiKey?), getVersion() }).
//
// COMPLIANCE CONTRACT (高德《合规使用方案》):
//   - consent === false  → init MUST NOT be called (SDK stays uninitialized).
//   - consent === true + key present → init called EXACTLY ONCE, WITH the key
//     (passing the key is what runs the native privacy registration; init() with
//     no key never registers privacy → white-screen + non-compliant).
//   - calling twice still inits only once (module-level guard).
//   - consent === true + key UNSET → init MUST NOT be called.

// jest.mock is hoisted above imports, so the factory may only reference vars
// whose name begins with `mock` (jest's allow-list).
const mockInit = jest.fn();
const mockGetVersion = jest.fn();

jest.mock('react-native-amap3d', () => ({
  AMapSdk: {
    init: (...args: unknown[]) => mockInit(...args),
    getVersion: (...args: unknown[]) => mockGetVersion(...args),
  },
}));

const KEY_ENV = 'EXPO_PUBLIC_AMAP_ANDROID_SDK_KEY';
const TEST_KEY = 'amap-test-key-abc123';

/** Load a FRESH copy of the module so its module-level `inited` flag resets. */
function loadModule() {
  let mod!: typeof import('../amapPrivacy');
  jest.isolateModules(() => {
    mod = require('../amapPrivacy');
  });
  return mod;
}

const originalKey = process.env[KEY_ENV];

beforeEach(() => {
  mockInit.mockClear();
  mockGetVersion.mockClear();
});

afterEach(() => {
  if (originalKey === undefined) delete process.env[KEY_ENV];
  else process.env[KEY_ENV] = originalKey;
});

describe('initAmapIfConsented', () => {
  it('does NOT init when consent is false (even with a key set)', () => {
    process.env[KEY_ENV] = TEST_KEY;
    const { initAmapIfConsented } = loadModule();
    initAmapIfConsented(false);
    expect(mockInit).not.toHaveBeenCalled();
  });

  it('inits EXACTLY ONCE WITH the env key when consent is true', () => {
    process.env[KEY_ENV] = TEST_KEY;
    const { initAmapIfConsented } = loadModule();
    initAmapIfConsented(true);
    expect(mockInit).toHaveBeenCalledTimes(1);
    expect(mockInit).toHaveBeenCalledWith(TEST_KEY);
  });

  it('still inits only once when called twice (double-init guard)', () => {
    process.env[KEY_ENV] = TEST_KEY;
    const { initAmapIfConsented } = loadModule();
    initAmapIfConsented(true);
    initAmapIfConsented(true);
    expect(mockInit).toHaveBeenCalledTimes(1);
  });

  it('does NOT init when consent is true but the key is unset', () => {
    delete process.env[KEY_ENV];
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { initAmapIfConsented } = loadModule();
    initAmapIfConsented(true);
    expect(mockInit).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
