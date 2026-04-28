import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // 固定 tracing 根目录，避免本机上层目录存在 lockfile 时影响构建产物。
  outputFileTracingRoot: appDir
};

export default nextConfig;

if (process.env.NODE_ENV === 'development') {
  // 本地开发时初始化 Cloudflare 绑定，让 next dev 和 Worker 预览的环境更接近。
  initOpenNextCloudflareForDev();
}
