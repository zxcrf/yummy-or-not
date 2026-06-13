// S3b-media capability-gate STUB tests.
//
// Scope per the plan: S3b only adds the `users.media_enabled` flag + a SERVER
// gate point that rejects a media (video / live-photo) upload when the flag is
// false. It does NOT build the live-photo/video pipeline — so these tests pin
// only the pure gate decision, not transcoding/poster extraction.
//
// The gate is the security boundary "media_enabled=false 时不能传 video"
// (§S3b-media verification) and MUST be enforced server-side regardless of the
// client. A still-image upload is always allowed; a video/live-photo upload is
// allowed ONLY when media_enabled is true.
//
// FAILS today: lib/storage.ts exports no isVideoUpload / assertMediaAllowed.
// PASSES once S3b adds the column + this gate helper (and wires it into the
// POST /api/tastes upload path).

import {
  // S3b-media gate helpers — do not exist yet (RED).
  isVideoUpload,
  assertMediaAllowed,
} from '@/lib/storage';

describe('isVideoUpload — classifies the upload as media or still image', () => {
  it('treats common video / live-photo content types as media', () => {
    expect(isVideoUpload('video/mp4', 'clip.mp4')).toBe(true);
    expect(isVideoUpload('video/quicktime', 'live.mov')).toBe(true);
  });

  it('treats still images as NOT media', () => {
    expect(isVideoUpload('image/jpeg', 'photo.jpg')).toBe(false);
    expect(isVideoUpload('image/webp', 'photo.webp')).toBe(false);
    expect(isVideoUpload('image/heic', 'photo.heic')).toBe(false);
  });

  it('falls back to the file extension when the content type is generic', () => {
    // Some clients send application/octet-stream; the extension still flags video.
    expect(isVideoUpload('application/octet-stream', 'clip.mov')).toBe(true);
    expect(isVideoUpload('application/octet-stream', 'photo.jpg')).toBe(false);
  });
});

describe('assertMediaAllowed — server-side capability gate', () => {
  it('rejects a video upload when media_enabled is false', () => {
    // Returns a machine-readable reason (route maps it to a 403) — does NOT throw
    // silently or pass. A non-null/false return means "blocked".
    const result = assertMediaAllowed({ mediaEnabled: false }, 'video/mp4', 'clip.mp4');
    expect(result).toBe('media_not_enabled');
  });

  it('allows a video upload when media_enabled is true', () => {
    expect(assertMediaAllowed({ mediaEnabled: true }, 'video/mp4', 'clip.mp4')).toBeNull();
  });

  it('always allows a still-image upload regardless of the flag', () => {
    expect(assertMediaAllowed({ mediaEnabled: false }, 'image/jpeg', 'photo.jpg')).toBeNull();
    expect(assertMediaAllowed({ mediaEnabled: true }, 'image/jpeg', 'photo.jpg')).toBeNull();
  });
});
