// APP_ENV profile resolver.
//
// APP_ENV selects a named defaults profile (host-agnostic — no "are we on
// Vercel" branching). Explicit environment variables ALWAYS win over the
// profile defaults, so the profile only fills gaps.
//
//   APP_ENV   "local" (default) | "validation" | "prod"
//
// Resolved keys:
//   PHOTO_STORAGE          "local" | "s3" | "blob"
//   PHOTO_PUBLIC_BASE_URL  public base for bare photo keys (no trailing slash)
//
// Explicit overrides (consulted before any profile default):
//   DATABASE_URL, PHOTO_STORAGE, PHOTO_PUBLIC_BASE_URL,
//   S3_*, BLOB_READ_WRITE_TOKEN

export type PhotoStorage = 'local' | 's3' | 'blob';
export type AppEnv = 'local' | 'validation' | 'prod';

interface ProfileDefaults {
  photoStorage: PhotoStorage;
}

const PROFILES: Record<AppEnv, ProfileDefaults> = {
  local:      { photoStorage: 'local' },
  validation: { photoStorage: 'blob' },
  prod:       { photoStorage: 'blob' },
};

function resolveAppEnv(): AppEnv {
  const raw = (process.env.APP_ENV ?? 'local').toLowerCase();
  if (raw === 'validation' || raw === 'prod') return raw;
  return 'local';
}

const profile = PROFILES[resolveAppEnv()];

/** Selected photo-storage backend. Explicit PHOTO_STORAGE overrides the profile. */
export function getPhotoStorage(): PhotoStorage {
  const explicit = process.env.PHOTO_STORAGE?.trim();
  if (explicit === 'local' || explicit === 's3' || explicit === 'blob') {
    return explicit;
  }
  return profile.photoStorage;
}

/** Public base URL for bare photo keys, no trailing slash. '' when unset. */
export function getPhotoPublicBaseUrl(): string {
  return (process.env.PHOTO_PUBLIC_BASE_URL ?? '').replace(/\/$/, '');
}
