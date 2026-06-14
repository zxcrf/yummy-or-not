// Expo config plugin: inject a release signingConfig into android/app/build.gradle
// that reads gradle properties YON_RELEASE_STORE_FILE / YON_RELEASE_KEY_ALIAS /
// YON_RELEASE_STORE_PASSWORD / YON_RELEASE_KEY_PASSWORD (provided by CI from a
// decoded keystore). Guarded by project.hasProperty('YON_RELEASE_STORE_FILE') so
// that when the secret is ABSENT no release signingConfig is created and the build
// falls back to the debug signing config. Idempotent against expo prebuild
// regeneration via a string-match guard.
const { withAppBuildGradle } = require('@expo/config-plugins');

const MARKER = 'yonRelease'; // signingConfig name + guard token

const SIGNING_CONFIG_BLOCK = `
        ${MARKER} {
            if (project.hasProperty('YON_RELEASE_STORE_FILE')) {
                storeFile file(YON_RELEASE_STORE_FILE)
                keyAlias YON_RELEASE_KEY_ALIAS
                storePassword YON_RELEASE_STORE_PASSWORD
                keyPassword YON_RELEASE_KEY_PASSWORD
            }
        }`;

/** Insert the signingConfig into the signingConfigs { } block. */
function injectSigningConfig(contents) {
  const anchor = 'signingConfigs {';
  const idx = contents.indexOf(anchor);
  if (idx === -1) return contents;
  const insertAt = idx + anchor.length;
  return contents.slice(0, insertAt) + SIGNING_CONFIG_BLOCK + contents.slice(insertAt);
}

/**
 * Point buildTypes.release at the yonRelease signingConfig WHEN the secret is
 * present; otherwise keep the existing (debug) fallback. Replaces the default
 * `signingConfig signingConfigs.debug` inside the release { } block.
 */
function wireReleaseBuildType(contents) {
  const releaseIdx = contents.indexOf('release {');
  if (releaseIdx === -1) return contents;

  // Scope the replace to the matched release { ... } block's braces so a later
  // (e.g. a custom flavor's) `signingConfig signingConfigs.debug` can't be
  // silently left debug-signed, and a non-global replace can't miss the real one.
  const braceStart = contents.indexOf('{', releaseIdx);
  let depth = 0;
  let braceEnd = -1;
  for (let i = braceStart; i < contents.length; i++) {
    const ch = contents[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        braceEnd = i + 1;
        break;
      }
    }
  }
  if (braceEnd === -1) {
    throw new Error(
      'withReleaseSigning: could not find the closing brace of the release { } block.',
    );
  }

  const head = contents.slice(0, braceStart);
  const block = contents.slice(braceStart, braceEnd);
  const tail = contents.slice(braceEnd);

  // Assert EXACTLY one debug signingConfig assignment in the release block.
  const re = /signingConfig signingConfigs\.debug/g;
  const matches = block.match(re) || [];
  if (matches.length !== 1) {
    throw new Error(
      `withReleaseSigning: expected exactly one 'signingConfig signingConfigs.debug' ` +
        `inside the release { } block, found ${matches.length}. Refusing to wire ` +
        `release signing (a release block could be left debug-signed).`,
    );
  }

  const replacement =
    'signingConfig project.hasProperty(\'YON_RELEASE_STORE_FILE\') ? signingConfigs.' +
    MARKER +
    ' : signingConfigs.debug';
  const wiredBlock = block.replace(re, replacement);
  return head + wiredBlock + tail;
}

/** @param {import('@expo/config-plugins').ExportedConfig} config */
const withReleaseSigning = (config) => {
  return withAppBuildGradle(config, (cfg) => {
    let contents = cfg.modResults.contents;

    // Idempotency guard: bail if our signingConfig is already present.
    if (contents.includes(MARKER + ' {')) {
      return cfg;
    }

    contents = injectSigningConfig(contents);
    contents = wireReleaseBuildType(contents);

    cfg.modResults.contents = contents;
    return cfg;
  });
};

module.exports = withReleaseSigning;
