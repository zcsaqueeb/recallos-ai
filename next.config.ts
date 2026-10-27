import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  reactStrictMode: false,
  // Hide the floating Next.js dev-tools "N" button in development.
  devIndicators: false,
  // The Sui gRPC stack (@grpc/grpc-js + @grpc/proto-loader) must stay external so
  // Next.js does not try to bundle its dynamic requires; the vendored Sui proto
  // tree is loaded from disk at runtime and must ship with the server output.
  serverExternalPackages: ["@grpc/grpc-js", "@grpc/proto-loader"],
  outputFileTracingIncludes: {
    "/api/**": ["./vendor/sui-grpc-proto/**/*"],
  },
};

export default nextConfig;
