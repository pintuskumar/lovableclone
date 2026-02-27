import withPWA from "next-pwa";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Handle ESM packages that need special treatment on server
  experimental: {
    serverComponentsExternalPackages: ["@daytonaio/sdk"],
  },
};

const pwaConfig = withPWA({
  dest: "public",
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === "development",
  // Filter out chrome-extension requests to prevent cache errors
  runtimeCaching: [
    {
      urlPattern: /^https?.*/,
      handler: "NetworkFirst",
      options: {
        cacheName: "offlineCache",
        expiration: {
          maxEntries: 200,
        },
      },
    },
  ],
});

export default pwaConfig(nextConfig);
