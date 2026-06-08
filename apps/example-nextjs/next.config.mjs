/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@authai/react", "@authai/server"],
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
