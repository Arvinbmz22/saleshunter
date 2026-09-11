import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  // Allow the sandboxed preview origin to load dev assets.
  ...(isDev ? { allowedDevOrigins: ["*.e2b.app", "*.arena.ai"] } : {}),
};

export default nextConfig;
