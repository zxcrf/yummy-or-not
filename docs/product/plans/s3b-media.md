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

## 3. Decisions — RESOLVED 2026-06-15 (user-confirmed)

- **D1. Video read delivery → private bucket + presigned GET.** Matches current photo privacy
  posture. TTL 3600s ≫ any 15s clip; player must **re-fetch a fresh presigned URL on error**
  (covers the pause-past-TTL edge). Not public CDN — clips stay private like photos.

- **D2. Pro gate → manual `media_enabled` flag for v1.** No billing dependency; admin/self sets
  the flag. Real Pro purchase wiring comes later, independently.

- **D3. Schema → add columns.** New migration `0012` adds to `tastes`: `media_type`
  (`'image' | 'video'`, default `'image'`), `clip_key` (text, nullable — the `t/{uuid}/clip.mp4`
  sibling), `duration_ms` (int, nullable). `image` stays the poster key (reuses the entire
  variant + read-resolver path unchanged). Explicit + queryable beats the implicit sibling-key
  convention.

- **D4. Android compression → caps-as-backstop, NO native dep in v1.** iOS uses picker
  `videoExportPreset` (reliable on-device re-encode); Android compression is weak, so the
  server hard caps (size+duration) + post-PUT `HEAD` verify reject anything oversize → user
  re-picks a shorter clip. A native compressor (`react-native-compressor`-class) is the
  **Phase 2 optimization** if Android cap-hit rate proves high — deferred to avoid the EAS
  rebuild + maintenance burden during v1. Decision is reversible (driven by real usage data).

- **D5. Playback → tap-to-play.** Card shows poster + play button; tap opens the clip. Cheaper
  bandwidth (every view re-downloads from R2; no autoplay-on-scroll re-download storm).

- **D6. HEIC poster → client converts to JPEG; server never decodes HEIF.** iOS Live Photo still
  is HEIC, but `compressAsset` (expo-image-manipulator) already outputs JPEG on-device (iOS
  decodes HEIC natively; Android 10+ too, and Android doesn't produce Apple Live Photos anyway).
  So the poster reaching the server is **always JPEG** → sharp never sees HEIC → **no libheif
  needed in the Docker image.** Risk eliminated, not deferred.

---

## 4. Risks (carry into implementation)

| Risk | Mitigation |
|---|---|
| Android clip too large after weak compression | hard server caps (size+duration) + post-PUT `HEAD` verify → reject + re-pick |
| Client poster extraction fails → no thumbnail | generic play-button placeholder; never block upload |
| Presigned URL expires mid-playback (long pause) | player re-fetches a fresh presigned URL on error; don't shorten video TTL |
| Each playback re-downloads from R2 (bandwidth = real cost) | size cap matters more than storage cap; tap-to-play not autoplay |
| Direct-PUT lets client upload arbitrary bytes | server `HEAD` verifies size/type before persisting; key namespaced + server-generated |
| sharp can't decode HEIC in Docker | **eliminated** (D6): client always sends JPEG poster; server never decodes HEIF |

Unverified (validate in impl, do NOT assume): SDK 56 Android compression behavior (D4 caps absorb it). SDK 56 `expo-video` / `generateThumbnailsAsync` / `pairedVideoAsset` / Passthrough-default confirmed from v56 docs.

---

## 5. Phase 1 concrete cut (what a first PR would touch)

- API: new `POST /api/uploads/presign` (auth'd) → returns presigned PUT + server key; `HEAD`-verify
  endpoint or fold verify into the metadata-commit. Reuse `s3Client()`/`getSignedUrl`.
- Mobile: avatar picker → presigned PUT → commit. Reuse `compressAsset`.
- Tests: presign auth gate; HEAD-verify rejects oversize/wrong-type; avatar renders.
- No video yet. Proves the direct-upload primitive on the safe path.

推荐执行模式（建议，非强制）：**Phase 1 = team**（API presign + mobile upload + schema 接口需同时敲定，2–3 个相互依赖组件）。**Phase 2 = workflow 或 concurrent**（视频管线多个同形单元 + 重验证）。两阶段都各加一道 Codex 跨模型 review。
