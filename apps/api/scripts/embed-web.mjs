#!/usr/bin/env node
// embed-web.mjs — export the Expo RN-Web app and copy it into apps/api/public/web/
// Runs from the monorepo root (Vercel: cd ../.. && node apps/api/scripts/embed-web.mjs)
// EXPO_PUBLIC_API_URL must be unset / empty so the web bundle uses same-origin "/api".

import { execSync } from 'child_process';
import { cpSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';

const ROOT = process.cwd();
const distDir = resolve(ROOT, 'apps/mobile/dist');
const destDir = resolve(ROOT, 'apps/api/public/web');

// 1. Export Expo web (static, with baseUrl:/web in app.json)
console.log('[embed-web] exporting Expo web bundle…');
execSync(
  'pnpm --filter @yon/mobile exec expo export -p web --clear',
  {
    cwd: ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      // Ensure same-origin API calls — unset any caller-supplied value.
      EXPO_PUBLIC_API_URL: '',
    },
  }
);

if (!existsSync(distDir)) {
  throw new Error(`[embed-web] expo export did not produce ${distDir}`);
}

// 2. Merge dist/* → apps/api/public/web/ (never wipe sibling public dirs)
console.log(`[embed-web] copying ${distDir} → ${destDir}`);
mkdirSync(destDir, { recursive: true });
cpSync(distDir, destDir, { recursive: true, force: true });

console.log('[embed-web] done — web bundle embedded at apps/api/public/web/');
