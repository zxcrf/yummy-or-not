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
  async redirects() {
    return [
      { source: '/', destination: '/web', permanent: false },
    ]
  },
  async rewrites() {
    return [
      { source: '/web', destination: '/web/index.html' },
      { source: '/web/', destination: '/web/index.html' },
    ]
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
