import type { NextConfig } from "next";

const nextConfig: NextConfig = {

  experimental: {
    optimizePackageImports: ["lucide-react", "@headlessui/react"],
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "res.cloudinary.com",
      },
    ],
  },
};

export default nextConfig;
