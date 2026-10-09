import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // certificados de faltas (hasta 4 MB) e importación de Excel (hasta 2 MB)
    serverActions: { bodySizeLimit: "4.5mb" },
  },
};

export default nextConfig;
