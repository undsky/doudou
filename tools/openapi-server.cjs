#!/usr/bin/env node

const http = require("http");

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 17878;
const commands = [];

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function createOpenUrlCommand(token, targetUrl, active) {
  return {
    version: 1,
    token,
    action: "openUrl",
    payload: {
      url: targetUrl,
      active,
    },
    createdAt: Date.now(),
  };
}

function startServer(options) {
  const host = options.host || DEFAULT_HOST;
  const port = Number(options.port || DEFAULT_PORT);

  const server = http.createServer((req, res) => {
    if (req.method === "OPTIONS") {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method !== "GET") {
      sendJson(res, 405, { ok: false, error: "Method Not Allowed" });
      return;
    }

    const requestUrl = new URL(req.url || "/", `http://${host}:${port}`);

    if (requestUrl.pathname === "/next") {
      const batch = commands.splice(0, commands.length);
      sendJson(res, 200, batch);
      return;
    }

    if (requestUrl.pathname === "/status") {
      sendJson(res, 200, { ok: true, pending: commands.length });
      return;
    }

    if (requestUrl.pathname !== "/open") {
      sendJson(res, 404, {
        ok: false,
        error: "Not Found",
        usage: `http://${host}:${port}/open?token=<token>&url=<url>&active=true`,
      });
      return;
    }

    const token = requestUrl.searchParams.get("token") || "";
    const targetUrl = requestUrl.searchParams.get("url") || "";
    const active = requestUrl.searchParams.get("active") !== "false";

    if (!token) {
      sendJson(res, 400, { ok: false, error: "缺少 token 参数" });
      return;
    }
    if (!targetUrl) {
      sendJson(res, 400, { ok: false, error: "缺少 url 参数" });
      return;
    }

    try {
      const parsedTarget = new URL(targetUrl);
      if (parsedTarget.protocol !== "http:" && parsedTarget.protocol !== "https:") {
        sendJson(res, 400, { ok: false, error: "url 仅支持 http 或 https" });
        return;
      }

      commands.push(createOpenUrlCommand(token, parsedTarget.href, active));
      sendJson(res, 200, {
        ok: true,
        queued: true,
        pending: commands.length,
        url: parsedTarget.href,
      });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message || "URL 格式不正确" });
    }
  });

  server.listen(port, host, () => {
    console.log(`豆豆开放接口 HTTP 服务已启动：http://${host}:${port}`);
    console.log(`调用示例：http://${host}:${port}/open?token=<token>&url=${encodeURIComponent("https://www.undsky.com/doudou")}&active=true`);
  });
}

startServer(parseArgs(process.argv.slice(2)));
