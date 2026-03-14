import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow larger file uploads (PDFs, DOCX) up to 20MB
  experimental: {
    serverActions: {
      bodySizeLimit: "20mb",
    },
  },
};

export default nextConfig;
