import type { NextConfig } from "next";
import path from "path";

const baseStub = path.resolve(__dirname, "lib/stub-base-account.ts");

const nextConfig: NextConfig = {
  transpilePackages: ["@rainbow-me/rainbowkit"],
  serverExternalPackages: ["@coinbase/cdp-sdk", "@base-org/account"],
  turbopack: {
    resolveAlias: {
      "@base-org/account": "./lib/stub-base-account.ts",
    },
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      "@base-org/account": baseStub,
    };
    return config;
  },
};

export default nextConfig;
