# S3b-media — design spec (video / live photo on taste cards)

Status: **DRAFT for decision** · 2026-06-15 · owner: @liukun
Tracking: #116 (follow-up 3). Gate landed in #91; this spec turns the gate into a feature.

> Scope: let a Pro user attach **one short video or iOS Live Photo** to a taste
> card (a few seconds of food). Out of scope: long video, multi-clip, editing,
> adaptive streaming, web playback.

---

## 1. Ground truth (what already exists — do not re-derive)

| Piece | Where | Note |
|---|---|---|
| Capability flag | `users.media_enabled boolean NOT NULL DEFAULT false` — `apps/api/db/schema.sql:43`, migration `0008` | Pro upgrade tier, **not** a `plan` enum value |
| Server gate | `isVideoUpload()` + `assertMediaAllowed()` — `apps/api/src/lib/storage.ts:57-79`, wired at `apps/api/src/app/api/tastes/route.ts:141` | classifies video by MIME + ext fallback; returns 403 `media_not_enabled`. Tested: `media-gate.test.ts` |
| Photo upload | **PROXY** — `route.ts:138-188`: API does `Buffer.from(await photo.arrayBuffer())` (whole file in RAM) → sharp → 3× `PutObjectCommand` | 25 MB cap at `route.ts:145` |
| Variants | `t/{uuid}/orig.{ext}` + `thumb.webp`(320) + `display.webp`(1280) — `image-variants.ts:27-70`; sharp **cannot decode video** | `isVariantKey` matches image keys only |
| Read resolver | `resolvePhotoUrls()` — `db.ts:90-138`: CDN base → presigned GET → local | presign GET exists; **presign PUT does not** |
| Presign | `getSignedPhotoUrl()` TTL `3600s` — `storage.ts:223`; share path uses `60s` | |
| Schema | `tastes.image text` (bare key) — `schema.sql:112-136`. **No** media_type / duration / poster / w-h columns | latest migration `0011` |
| Mobile | Expo SDK `~56.0.9`; `expo-image` `~56.0.10`, `expo-image-picker` `^56.0.16`, `expo-image-manipulator` `^56.0.17`. **No `expo-video`/`expo-av`** | `compressAsset` already downscales 2560px q0.85 cross-platform — `AddModal.tsx:102-121` |
| Card render | `expo-image` `Image` in `FoodCard.tsx`; cache key `${imageKey}:thumb` survives presign rotation | |

**The constraint that drives everything:** the API host is a single small box and is
currently *in the byte path* for uploads. Photos (~2 MB) are fine; a phone video clip
(15–60 MB uncompressed, `videoExportPreset` defaults to **Passthrough/no-compress**)
buffered in Node heap = OOM under concurrency, and sharp can't make a poster for it.

---

## 2. Locked decisions (recommended — architect-reviewed, opus)

1. **No server transcode in v1.** Client normalizes; server stores as-is. Reject Cloudflare
   Stream (second billing/storage system, against self-host ethos). Defer self-hosted
   ffmpeg worker to a later phase, only if Android sizes force it.
2. **Video bytes bypass the proxy — presigned-PUT direct-to-R2.** New flow: client asks API
   for a presigned PUT (server-generated key in the user's namespace) → client PUTs the clip
   straight to R2 → client POSTs *metadata only* (key, duration, w/h, poster key) to the API.
   The API never touches the video bytes. (`getSignedUrl` already imported; only GET-side built.)
   Server `HEAD`s the object post-PUT to verify real size/type before persisting the row.
3. **Poster = client-extract → existing image pipeline.** `expo-video.generateThumbnailsAsync()`
   grabs ~0.5s frame on-device, pushed through the *current* photo path → free `thumb.webp` +
   `display.webp`, keyed like any image poster. Card render is then **unchanged**
   (`resolvePhotoUrls` already handles it). Clip stored as sibling key `t/{uuid}/clip.mp4`.
4. **Live Photo = still poster + paired MOV as a normal clip** (picker `pairedVideoAsset`).
   No native press-hold `PHLivePhoto` UX. Motion on tap, ~zero extra code.
5. **Progressive MP4, not HLS.** Single object, no manifest/segmenting, no transcode.
   `expo-video` (`useVideoPlayer` + `VideoView`) — current, non-deprecated; `expo-av` is legacy.
6. **Caps (v1):** duration **15s**, file **20 MB** (separate + lower than the 25 MB image cap,
   verified via post-PUT `HEAD`, not buffering), target **720p** H.264 via iOS export preset.
   Size cap is the real backstop; Android compression is weak → caps reject + user re-picks.
7. **Phasing:**
   - **Phase 1** — avatar upload + image refactor, **and introduce presigned-PUT direct upload
     on the safe image case first** (proxy stays as fallback). De-risks the upload primitive
     before video rides it. Avatar is just a still through the existing pipeline + gate exists.
   - **Phase 2** — video: Phase-1 upload path + client poster + caps + Live-Photo-as-clip + player.

---

## 3. Open decisions — NEED HUMAN CONFIRM before build

These change cost / UX / scope; defaults in **bold**.

- **D1. Video read delivery: public CDN base vs presigned GET?**
  If clips can sit on the same public CDN base as images (`resolvePhotoUrls` already prefers
  CDN), presigning disappears and the TTL-expiry-mid-playback gotcha vanishes. If the bucket
  must stay private, presigned GET is fine for 15s clips (TTL 3600 ≫ clip).
  → **Default: keep private + presigned GET** (matches current photo privacy posture). Confirm
  whether food clips are OK to serve from a public CDN — that's simpler + cheaper if acceptable.

- **D2. Pro gate UX.** `media_enabled` is set how? No billing exists yet. For v1, is it a manual
  flag (admin/self) or tied to a (not-yet-built) Pro purchase?
  → **Default: manual flag for v1** (no billing dependency), real Pro purchase later.

- **D3. Schema for media metadata.** Need new columns vs sibling-key convention. Minimum:
  a `media_type` discriminator on `tastes` (`'image' | 'video'`), plus `duration_ms`,
  `poster_key` (or reuse `image` for poster + new `clip_key`). New migration `0012`.
  → **Default: add `media_type`, `clip_key`, `duration_ms` to `tastes`; `image` stays the poster.**

- **D4. Android compression reliability.** `expo-image-picker` video compression is
  export-preset on iOS, weak on Android. Accept "Android may hit the cap + re-pick" for v1, or
  add a native compressor (EAS build + maintenance burden)?
  → **Default: accept caps-as-backstop, no native dep in v1.**

- **D5. Autoplay-muted-on-scroll vs tap-to-play.**
  → **Default: tap-to-play** (cheaper bandwidth; every view re-downloads from R2).

- **D6. sharp HEIF support in the Docker image** (needed to make a poster from a Live Photo HEIC
  still). If absent → convert still to JPEG on-device first (already do JPEG re-encode in
  `compressAsset`). **Verify during impl, not assumed.**

---

## 4. Risks (carry into implementation)

| Risk | Mitigation |
|---|---|
| Android clip too large after weak compression | hard server caps (size+duration) + post-PUT `HEAD` verify → reject + re-pick |
| Client poster extraction fails → no thumbnail | generic play-button placeholder; never block upload |
| Presigned URL expires mid-playback (long pause) | player re-fetches a fresh presigned URL on error; don't shorten video TTL |
| Each playback re-downloads from R2 (bandwidth = real cost) | size cap matters more than storage cap; tap-to-play not autoplay |
| Direct-PUT lets client upload arbitrary bytes | server `HEAD` verifies size/type before persisting; key namespaced + server-generated |
| sharp can't decode HEIC in Docker | on-device HEIC→JPEG before upload (poster path) |

Unverified (validate in impl, do NOT assume): SDK 56 Android compression behavior; sharp HEIF in prod image. SDK 56 `expo-video` / `generateThumbnailsAsync` / `pairedVideoAsset` / Passthrough-default confirmed from v56 docs.

---

## 5. Phase 1 concrete cut (what a first PR would touch)

- API: new `POST /api/uploads/presign` (auth'd) → returns presigned PUT + server key; `HEAD`-verify
  endpoint or fold verify into the metadata-commit. Reuse `s3Client()`/`getSignedUrl`.
- Mobile: avatar picker → presigned PUT → commit. Reuse `compressAsset`.
- Tests: presign auth gate; HEAD-verify rejects oversize/wrong-type; avatar renders.
- No video yet. Proves the direct-upload primitive on the safe path.

推荐执行模式（建议，非强制）：**Phase 1 = team**（API presign + mobile upload + schema 接口需同时敲定，2–3 个相互依赖组件）。**Phase 2 = workflow 或 concurrent**（视频管线多个同形单元 + 重验证）。两阶段都各加一道 Codex 跨模型 review。
