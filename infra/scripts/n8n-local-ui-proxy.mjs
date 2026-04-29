#!/usr/bin/env node
// 本地 n8n 编辑器代理：静态资源走本机，API 请求转发到远端 n8n。
import { createReadStream, existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const port = Number(process.env.N8N_LOCAL_UI_PORT || 15678);
const remoteOrigin = new URL(process.env.N8N_REMOTE_ORIGIN || 'http://127.0.0.1:5678');
const editorDist = process.env.N8N_EDITOR_DIST || '/tmp/news-n8n-editor-ui/package/dist';

const configTags = [
  '<meta name="n8n:config:rest-endpoint" content="cmVzdA==">',
  '<meta name="n8n:config:sentry" content="eyJkc24iOiIiLCJlbnZpcm9ubWVudCI6ImRldmVsb3BtZW50IiwicmVsZWFzZSI6Im44bkAyLjE3LjUifQ==">',
].join('');

const mimeTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.gif', 'image/gif'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.wasm', 'application/wasm'],
  ['.woff2', 'font/woff2'],
]);

// 判断请求是否应该转给远端 n8n 后端，避免把 API 当成本地静态资源处理。
const shouldProxyToRemote = (pathname) => {
  const firstSegment = pathname.split('/').filter(Boolean)[0] || '';
  return ['api', 'e2e', 'healthz', 'metrics', 'push', 'rest', 'webhook', 'webhook-test'].includes(firstSegment);
};

// 返回文件扩展名对应的 Content-Type，未知类型按二进制流处理。
const getContentType = (filePath) => {
  return mimeTypes.get(path.extname(filePath)) || 'application/octet-stream';
};

// 发送本地文件，供 n8n 前端静态资源使用。
const sendFile = (response, filePath) => {
  const fileStat = statSync(filePath);
  response.writeHead(200, {
    'Cache-Control': 'public, max-age=31536000, immutable',
    'Content-Length': fileStat.size,
    'Content-Type': getContentType(filePath),
  });
  createReadStream(filePath).pipe(response);
};

// 渲染 n8n 单页应用入口，并补齐 n8n 运行时配置标签。
const sendIndex = async (response) => {
  const indexPath = path.join(editorDist, 'index.html');
  const rawHtml = await readFile(indexPath, 'utf8');
  const html = rawHtml
    .replace('%CONFIG_TAGS%', configTags)
    .replaceAll('/{{BASE_PATH}}/', '/')
    .replaceAll('{{BASE_PATH}}', '');

  response.writeHead(200, {
    'Cache-Control': 'no-store',
    'Content-Type': 'text/html; charset=utf-8',
  });
  response.end(html);
};

// 转发普通 HTTP 请求到远端 n8n，登录态 Cookie 会自然透传给本地浏览器。
const proxyHttp = (request, response) => {
  const headers = { ...request.headers, host: remoteOrigin.host };
  const upstreamRequest = http.request(
    {
      headers,
      hostname: remoteOrigin.hostname,
      method: request.method,
      path: request.url,
      port: remoteOrigin.port || 80,
    },
    (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    },
  );

  upstreamRequest.on('error', (error) => {
    response.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(`n8n remote proxy failed: ${error.message}`);
  });

  request.pipe(upstreamRequest);
};

// 转发 WebSocket 升级请求，n8n 画布实时状态和执行日志需要这条连接。
const proxyWebSocket = (request, socket, head) => {
  const upstreamSocket = net.connect(Number(remoteOrigin.port || 80), remoteOrigin.hostname, () => {
    const headers = { ...request.headers, host: remoteOrigin.host };
    const headerLines = Object.entries(headers).map(([key, value]) => `${key}: ${value}`);
    upstreamSocket.write(`${request.method} ${request.url} HTTP/${request.httpVersion}\r\n`);
    upstreamSocket.write(`${headerLines.join('\r\n')}\r\n\r\n`);
    upstreamSocket.write(head);
    upstreamSocket.pipe(socket);
    socket.pipe(upstreamSocket);
  });

  upstreamSocket.on('error', () => socket.destroy());
};

// 主请求处理：API 转远端，静态资源从本地 dist 读取，其它路由回落到 SPA 入口。
const handleRequest = async (request, response) => {
  try {
    const requestUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    const pathname = decodeURIComponent(requestUrl.pathname);

    if (shouldProxyToRemote(pathname)) {
      proxyHttp(request, response);
      return;
    }

    if (pathname === '/static/base-path.js') {
      response.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Type': 'text/javascript; charset=utf-8',
      });
      response.end("window.BASE_PATH = '/';\n");
      return;
    }

    const staticPath = path.normalize(path.join(editorDist, pathname));
    if (staticPath.startsWith(editorDist) && existsSync(staticPath) && statSync(staticPath).isFile()) {
      sendFile(response, staticPath);
      return;
    }

    await sendIndex(response);
  } catch (error) {
    response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(error instanceof Error ? error.message : String(error));
  }
};

const server = http.createServer(handleRequest);
server.on('upgrade', proxyWebSocket);
server.listen(port, '127.0.0.1', () => {
  const scriptName = path.basename(fileURLToPath(import.meta.url));
  console.log(`${scriptName} listening on http://127.0.0.1:${port}`);
  console.log(`proxying n8n API to ${remoteOrigin.href}`);
});
