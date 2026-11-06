import path from "node:path";
import type { NextConfig } from "next";

// This folder is its own project: pin the root so Next never picks up a lockfile or files from a folder above it.
const root = path.resolve(process.cwd());

const nextConfig: NextConfig = {
  turbopack: { root },
  outputFileTracingRoot: root,
};

export default nextConfig;
