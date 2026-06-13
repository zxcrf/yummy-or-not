// Pluggable photo-upload abstraction.
//
// Backend is selected by getPhotoStorage() (env.ts → PHOTO_STORAGE / APP_ENV):
//   "local" (default) | "s3" | "blob"
//
// IMPORTANT — uploadPhoto stores and RETURNS A KEY, not an absolute URL.
// Each backend physically stores the object under `key` and returns a value
// that gets persisted in the DB `image` column:
//   - local : stores public/uploads/<key>, returns the bare key "<key>"
//   - s3    : stores <bucket>/<key>,        returns the bare key "<key>"
//   - blob  : stores the object, returns the FULL public URL (see below)
// The read-side resolver (db.ts resolvePhotoUrl) turns a bare key into an
// absolute URL via PHOTO_PUBLIC_BASE_URL, and passes http(s)/uploads through.
//
// Blob exception: @vercel/blob appends a random suffix to the pathname, so the
// public URL is NOT derivable from the key. We therefore store the full
// returned URL for blob and rely on legacy passthrough to render it. Tradeoff:
// because a blob image is persisted as an https:// URL, the DELETE route's
// owned-key check skips it, so blob objects are not garbage-collected on row
// delete. deleteFromBlob accepts that URL directly if a caller opts in later.
//
// S3 / S3-compatible (AWS S3, Cloudflare R2, Supabase Storage):
//   S3_ENDPOINT          optional custom endpoint URL (omit for AWS)
//   S3_REGION            AWS region, e.g. "us-east-1" or "auto" for R2
//   S3_BUCKET            bucket name
//   S3_ACCESS_KEY_ID     access key
//   S3_SECRET_ACCESS_KEY secret key
//
// Vercel Blob:
//   BLOB_READ_WRITE_TOKEN  read-write token
//
// Local:
//   Writes to <cwd>/public/uploads/<key>. Suitable for local dev; not for
//   serverless / ephemeral hosts.

import path from 'path';
import { writeFile, mkdir, unlink } from 'fs/promises';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getPhotoStorage } from './env';

export interface UploadOptions {
  key: string;
  contentType: string;
}

// ── S3b-media capability gate ─────────────────────────────────────────────────
//
// S3b only adds the GATE POINT, not the live-photo / video pipeline. The gate is
// the security boundary "media_enabled=false 时不能传 video": a still image is
// always allowed; a video / live-photo upload is allowed ONLY when the account's
// media_enabled flag is true. Enforced server-side, never trusting the client.

/** True when an upload is video / live-photo (media) rather than a still image.
 *  Classifies on the content type, falling back to the filename extension when
 *  the type is generic (some clients send application/octet-stream). */
export function isVideoUpload(contentType: string, filename = ''): boolean {
  const ct = (contentType || '').toLowerCase();
  if (ct.startsWith('video/')) return true;
  if (ct.startsWith('image/')) return false;
  // Generic / unknown type — fall back to the extension.
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  return ['mp4', 'mov', 'm4v', 'qt', 'webm', 'avi', 'mkv', '3gp'].includes(ext);
}

/** Machine-readable reason a media upload was blocked (route maps it to a 403). */
export type MediaGateReason = 'media_not_enabled';

/** Server-side capability gate. Returns a MediaGateReason ('media_not_enabled')
 *  when a video / live-photo upload is attempted without the media capability,
 *  or null when the upload is permitted (always permitted for still images). */
export function assertMediaAllowed(
  user: { mediaEnabled: boolean },
  contentType: string,
  filename = ''
): MediaGateReason | null {
  if (!isVideoUpload(contentType, filename)) return null;
  return user.mediaEnabled ? null : 'media_not_enabled';
}

/**
 * Upload a photo buffer and return the value to persist in the DB `image`
 * column. For local/s3 this is the bare key; for blob it is the full public
 * URL (see module header). Backend is selected by getPhotoStorage().
 */
export async function uploadPhoto(
  buffer: Buffer,
  opts: UploadOptions
): Promise<string> {
  const backend = getPhotoStorage();

  if (backend === 's3') {
    return uploadToS3(buffer, opts);
  }
  if (backend === 'blob') {
    return uploadToBlob(buffer, opts);
  }
  return uploadToLocal(buffer, opts);
}

/**
 * Delete a previously-uploaded object by its bare storage key. Backend is
 * selected by getPhotoStorage(). Callers treat this as best-effort.
 */
export async function deletePhoto(key: string): Promise<void> {
  const backend = getPhotoStorage();

  if (backend === 's3') {
    return deleteFromS3(key);
  }
  if (backend === 'blob') {
    return deleteFromBlob(key);
  }
  return deleteFromLocal(key);
}

// ── Local backend ─────────────────────────────────────────────────────────────

async function uploadToLocal(buffer: Buffer, { key }: UploadOptions): Promise<string> {
  const filePath = path.join(process.cwd(), 'public', 'uploads', key);
  // Keys may contain path separators (e.g. t/{uuid}/orig.jpg), so ensure
  // the full directory tree exists before writing.
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, buffer);
  return key;
}

async function deleteFromLocal(key: string): Promise<void> {
  await unlink(path.join(process.cwd(), 'public', 'uploads', key));
}

// ── S3 backend ────────────────────────────────────────────────────────────────

function s3Client() {
  const endpoint = process.env.S3_ENDPOINT;
  const region   = process.env.S3_REGION ?? 'us-east-1';
  const accessKeyId     = process.env.S3_ACCESS_KEY_ID     ?? '';
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY ?? '';
  return new S3Client({
    region,
    ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
    credentials: { accessKeyId, secretAccessKey },
  });
}

async function uploadToS3(buffer: Buffer, { key, contentType }: UploadOptions): Promise<string> {
  const client = s3Client();
  const bucket = process.env.S3_BUCKET ?? '';

  // Cloudflare R2 controls public access via the bucket's r2.dev URL / custom
  // domain, not per-object ACLs, and rejects `ACL: public-read`. Set
  // S3_NO_ACL=true for R2; other S3-compatible stores (AWS, B2) keep the ACL.
  const noAcl = (process.env.S3_NO_ACL ?? '').toLowerCase() === 'true';

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      ...(noAcl ? {} : { ACL: 'public-read' as const }),
    })
  );

  return key;
}

async function deleteFromS3(key: string): Promise<void> {
  const client = s3Client();
  const bucket = process.env.S3_BUCKET ?? '';

  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

// ── Presigned read URL ───────────────────────────────────────────────────────

export const PRESIGN_TTL_SECONDS = 3600; // 1h — limit leaked URL lifetime

export async function getSignedPhotoUrl(
  key: string,
  ttlSeconds = PRESIGN_TTL_SECONDS
): Promise<string> {
  const client = s3Client();
  const bucket = process.env.S3_BUCKET ?? '';

  return getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { expiresIn: ttlSeconds }
  );
}

// ── Vercel Blob backend ─────────────────────────────────────────────────────────

async function uploadToBlob(buffer: Buffer, { key, contentType }: UploadOptions): Promise<string> {
  const { put } = await import('@vercel/blob');
  const { url } = await put(key, buffer, {
    access: 'public',
    contentType,
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });
  // Blob's public URL is not derivable from the key, so we persist the full URL.
  return url;
}

async function deleteFromBlob(urlOrKey: string): Promise<void> {
  const { del } = await import('@vercel/blob');
  await del(urlOrKey, { token: process.env.BLOB_READ_WRITE_TOKEN });
}
