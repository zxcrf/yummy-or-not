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
import { getPhotoStorage } from './env';

export interface UploadOptions {
  key: string;
  contentType: string;
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
  const uploadsDir = path.join(process.cwd(), 'public', 'uploads');
  await mkdir(uploadsDir, { recursive: true });
  await writeFile(path.join(uploadsDir, key), buffer);
  return key;
}

async function deleteFromLocal(key: string): Promise<void> {
  await unlink(path.join(process.cwd(), 'public', 'uploads', key));
}

// ── S3 backend ────────────────────────────────────────────────────────────────

function s3Client() {
  return import('@aws-sdk/client-s3').then(({ S3Client }) => {
    const endpoint = process.env.S3_ENDPOINT;
    const region   = process.env.S3_REGION ?? 'us-east-1';
    const accessKeyId     = process.env.S3_ACCESS_KEY_ID     ?? '';
    const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY ?? '';
    return new S3Client({
      region,
      ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
      credentials: { accessKeyId, secretAccessKey },
    });
  });
}

async function uploadToS3(buffer: Buffer, { key, contentType }: UploadOptions): Promise<string> {
  const { PutObjectCommand } = await import('@aws-sdk/client-s3');
  const client = await s3Client();
  const bucket = process.env.S3_BUCKET ?? '';

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      ACL: 'public-read',
    })
  );

  return key;
}

async function deleteFromS3(key: string): Promise<void> {
  const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
  const client = await s3Client();
  const bucket = process.env.S3_BUCKET ?? '';

  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
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
