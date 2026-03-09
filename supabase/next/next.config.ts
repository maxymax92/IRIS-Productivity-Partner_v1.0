import type { NextConfig } from 'next'
import path from 'path'

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Standalone output for production (Railway / Docker)
  output: 'standalone',

  // Include files from monorepo root for standalone output
  outputFileTracingRoot: path.join(__dirname, '../../'),

  // Agent SDK spawns cli.js as a subprocess — must not be bundled
  // (bundling breaks import.meta.url path resolution for the CLI binary)
  serverExternalPackages: ['@anthropic-ai/claude-agent-sdk'],

  // Agent SDK runtime files (cli.js, wasm, vendor/ripgrep) are spawned/loaded
  // at runtime, not imported — file tracing misses them without this
  outputFileTracingIncludes: {
    '/api/chat': ['./node_modules/@anthropic-ai/claude-agent-sdk/**/*'],
  },

  // TypeScript
  typescript: {
    ignoreBuildErrors: false,
  },

  // React Compiler (moved from experimental in Next.js 16)
  reactCompiler: false,

  // Tree-shake barrel re-exports for large icon/utility libraries
  experimental: {
    optimizePackageImports: ['lucide-react', 'date-fns', 'radix-ui'],
  },

  // Service worker headers — ensure sw.js is served fresh and with correct MIME type
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
        ],
      },
    ]
  },

  // Image optimization — allow remote patterns for external avatars
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'models.dev',
        pathname: '/logos/*',
      },
    ],
  },
}

export default nextConfig
