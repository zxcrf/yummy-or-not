/* ============================================================
   Guard test — the react-native-amap3d teardown patch must stay wired.

   The mobile AMap MapView crashed the whole app on unmount: the library calls
   TextureMapView.onDestroy() from onDropViewInstance with no lifecycle and no
   guard, which NPEs inside the SDK. Every dismissal of a map-bearing screen (the
   location picker) took the app down. The fix is a pnpm patch that pauses +
   guards the teardown (patches/react-native-amap3d.patch).

   That native fix can't be exercised in jest, so this repo-config guard pins
   that the patch stays registered and still wraps onDestroy — if a dependency
   bump or a careless install drops it, this fails instead of silently shipping
   the crash again. It lives here (not in apps/mobile) because this package's
   tsconfig has Node types for fs/path. See react-native-maps#414 / #5668.
   ============================================================ */

import { readFileSync } from 'fs';
import { resolve } from 'path';

const REPO_ROOT = resolve(__dirname, '../../../../..');

describe('react-native-amap3d unmount-crash patch', () => {
  it('is registered in the root pnpm.patchedDependencies', () => {
    const pkg = JSON.parse(readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf8'));
    const patched: Record<string, string> = pkg?.pnpm?.patchedDependencies ?? {};
    const key = Object.keys(patched).find((k) => k.startsWith('react-native-amap3d'));
    expect(key).toBeTruthy();
    expect(patched[key as string]).toBe('patches/react-native-amap3d.patch');
  });

  it('guards the native MapView teardown (onPause + try/catch around onDestroy)', () => {
    const patch = readFileSync(resolve(REPO_ROOT, 'patches/react-native-amap3d.patch'), 'utf8');
    expect(patch).toMatch(/onDropViewInstance/);
    expect(patch).toMatch(/\+\s*try \{/);
    expect(patch).toMatch(/\+\s*view\.onPause\(\)/);
    expect(patch).toMatch(/\+\s*view\.onDestroy\(\)/);
    expect(patch).toMatch(/\+\s*\} catch \(e: Throwable\)/);
  });
});
