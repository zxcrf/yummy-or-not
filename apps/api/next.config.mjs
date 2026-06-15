/** @type {import('next').NextConfig} */

// Build an <Image> remotePattern from a public base URL by extracting its
// host. Returns null when the value is unset or not a valid URL (safe
// fallback — we simply omit the pattern rather than crashing the build).
function remotePatternFromBase(base) {
  if (!base) return null;
  try {
    const { protocol, hostname } = new URL(base);
    return { protocol: /** @type {"https"|"http"} */ (protocol.replace(":", "")), hostname };
  } catch {
    return null;
  }
}

// Primary: PHOTO_PUBLIC_BASE_URL (the base used to render bare photo keys).
// Fallback: legacy S3_PUBLIC_BASE_URL, for configs that still set it.
const photoPattern =
  remotePatternFromBase(process.env.PHOTO_PUBLIC_BASE_URL) ??
  remotePatternFromBase(process.env.S3_PUBLIC_BASE_URL);

const nextConfig = {
  output: 'standalone',
  // sharp uses native binaries; tell Next.js to leave it as a server-side
  // external rather than bundling it, so the prebuilt @img/sharp-* binary
  // survives the standalone copy without a separate webpack loader.
  serverExternalPackages: ['sharp'],
  // The shared api-client exports a MOBILE-ONLY upload helper
  // (uploadToPresignedUrl) that lazy-`require`s 'expo-file-system/legacy'. The
  // API imports @yon/shared, so webpack statically follows that require into
  // expo-file-system's RN source (→ expo-modules-core) and fails the production
  // build ("Module not found" / "Build failed because of webpack errors") even
  // though the API never calls it. Stub the RN-only module to an empty module
  // for the server build (a standard platform-stub) — it is never executed
  // server-side. Mobile is unaffected (it bundles via metro, not next.config).
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      'expo-file-system/legacy': false,
      'expo-file-system': false,
    };
    return config;
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
      // Public photo host (set PHOTO_PUBLIC_BASE_URL at build time).
      ...(photoPattern ? [photoPattern] : []),
    ],
  },
};

export default nextConfig;
