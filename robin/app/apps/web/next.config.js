/** @type {import('next').NextConfig} */
const nextConfig = {
  // Disable image optimization — all images are local files
  images: {
    unoptimized: true,
  },
  // Allow localhost origins for dev
  allowedDevOrigins: ['localhost', '127.0.0.1'],
  // Transpile the workspace packages
  transpilePackages: ['@robin/converter'],
  reactStrictMode: true,
  // Keep ws and native Node modules out of the webpack bundle
  serverExternalPackages: ['ws', 'better-sqlite3', 'sqlite-vec', 'sqlite-vec-darwin-arm64'],
  experimental: {
    optimizePackageImports: ['lucide-react', 'motion'],
  },
};

module.exports = nextConfig;
