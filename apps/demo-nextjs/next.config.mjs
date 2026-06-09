/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Required for the Dokku Dockerfile build — copies a self-contained
  // .next/standalone/ tree the runtime stage runs as `node server.js`.
  output: "standalone",
  // Tells Next.js to trace files across the monorepo root, not just this
  // app dir — without this, the standalone build misses workspace package
  // sources resolved via transpilePackages.
  outputFileTracingRoot: new URL("../../", import.meta.url).pathname,
  transpilePackages: ["@authai-io/react", "@authai-io/server"],
  webpack(config) {
    // Allow .js imports to resolve .ts / .tsx source files (ESM convention
    // used by workspace packages that ship raw TypeScript).
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    };
    return config;
  },
};
export default nextConfig;
