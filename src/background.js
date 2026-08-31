// Cookie 工具
import {
  cookiesToNetscapeFile,
  cookiesToObject,
  cookiesToHeaderString,
  cookiesToDetailedArray,
} from "./utils/cookie.js";

// OpenAI 客户端
import { OpenAIClient, getTranslateConfig } from "./ai/openai.js";

import { safeCaptureVisibleTab } from "./utils/capture.js";

// LLM 输出清理工具
function cleanLLMOutput(text) {
  if (!text) return text;
  let cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  cleaned = cleaned.replace(/<think>[\s\S]*$/gi, "");
  return cleaned.trim();
}

const DOUDOU_MESSAGE_TYPES = new Set([
  "GET_PAGE_COOKIES",
  "CORS_UPDATE_CONFIG",
  "GET_CORS_STATUS",
  "DOUDOU_BTN_ACTION",
  "POPUP_CAPTURE_SCREENSHOT",
  "DOWNLOAD_SCREENSHOT",
  "DOUDOU_DOWNLOAD_MEDIA",
  "DOUDOU_TRANSLATE_PAGE",
  "OPEN_TAB",
]);

// 消息监听
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (DOUDOU_MESSAGE_TYPES.has(request.type)) {
    (async () => {
      try {
        const result = await handleMessage(request, sender);
        sendResponse(result);
      } catch (err) {
        console.error("[豆豆] 消息处理错误:", err);
        sendResponse({ error: err.message || "未知错误" });
      }
    })();
    return true; // 表示异步响应
  }
  return false;
});

// 长连接监听(流式对话)
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "doudou-chat") return;

  let disconnected = false;
  port.onDisconnect.addListener(() => {
    disconnected = true;
  });

  port.onMessage.addListener(async (msg) => {
    if (msg.type !== "DOUDOU_CHAT_STREAM") return;

    try {
      const config = await getTranslateConfig();

      if (!config.apiKey) {
        console.error("[豆豆] 配置错误: 未找到有效的 API Key");
        port.postMessage({
          type: "error",
          data: "请先在「设置」→「翻译配置」中填写 API Key",
        });
        return;
      }

      const client = new OpenAIClient({
        apiKey: config.apiKey,
        baseURL: config.baseUrl || "https://api.openai.com/v1",
        model: config.model || "gpt-4o",
      });

      console.log(`[豆豆] Base URL: ${client.baseURL}`);
      console.log(`[豆豆] Model: ${client.model}`);
      console.log(`[豆豆] 完整请求地址: ${client.baseURL}/chat/completions`);

      const messages = OpenAIClient.formatMessages(msg.messages);
      const response = await fetch(`${client.baseURL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${client.apiKey}`,
        },
        body: JSON.stringify({ model: client.model, messages, stream: true }),
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => "");
        port.postMessage({
          type: "error",
          data: `API 错误 ${response.status}: ${errText.slice(0, 200)}`,
        });
        return;
      }

      await streamSSEResponse(response, port, () => disconnected);

      if (!disconnected) {
        port.postMessage({ type: "done", data: null });
      }
    } catch (err) {
      console.error("[豆豆] 流式对话错误:", err);
      if (!disconnected)
        port.postMessage({ type: "error", data: err.message || "请求失败" });
    }
  });
});

/**
 * 解析 SSE 流式响应
 */
async function streamSSEResponse(response, port, isDisconnected) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let reasoningContent = "";

  let lastCheckLenReasoning = 0;
  let lastCheckLenContent = 0;

  function isLooping(text, isReasoning) {
    const lastLen = isReasoning ? lastCheckLenReasoning : lastCheckLenContent;
    if (text.length - lastLen < 80) return false;
    if (isReasoning) lastCheckLenReasoning = text.length;
    else lastCheckLenContent = text.length;

    const maxL = Math.min(1000, Math.floor(text.length / 3));
    for (let L = 50; L <= maxL; L++) {
      const p1 = text.slice(-L);
      const p2 = text.slice(-2 * L, -L);
      const p3 = text.slice(-3 * L, -2 * L);
      if (p1 === p2 && p2 === p3) {
        if (new Set(p1).size > 5) return true;
      }
    }
    return false;
  }

  try {
    while (true) {
      if (isDisconnected()) {
        await reader.cancel().catch(() => {});
        break;
      }

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") continue;

        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta;

          if (delta?.reasoning_content) {
            reasoningContent += delta.reasoning_content;
            port.postMessage({
              type: "reasoning",
              data: delta.reasoning_content,
            });
          }

          if (delta?.content) {
            content += delta.content;
            port.postMessage({ type: "chunk", data: delta.content });
          }

          if (
            (reasoningContent && isLooping(reasoningContent, true)) ||
            (content && isLooping(content, false))
          ) {
            port.postMessage({
              type: "error",
              data: "由于 AI 模型推理陷入重复死循环，系统已自动中断本次回复。建议重新开启对话或修改提问内容。",
            });
            await reader.cancel().catch(() => {});
            break;
          }
        } catch {}
      }
    }
  } catch (err) {
    if (!isDisconnected()) throw err;
  } finally {
    try {
      reader.releaseLock();
    } catch {}
  }
}

async function handleMessage(request, sender) {
  switch (request.type) {
    case "GET_PAGE_COOKIES":
      return getPageCookies(request.url, request.format);
    case "CORS_UPDATE_CONFIG": {
      const corsStatus = await updateCorsRules(request.config);
      return { success: true, ...corsStatus };
    }
    case "GET_CORS_STATUS":
      return { success: true, ...(await getCorsStatus()) };
    case "DOUDOU_BTN_ACTION": {
      // popup 发送时 sender.tab 为 undefined，回退到 request.tab 或查询当前活动标签
      const actionTab =
        sender.tab ||
        request.tab ||
        (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
      return await handleDoudouBtnAction(request.action, actionTab);
    }
    case "POPUP_CAPTURE_SCREENSHOT": {
      try {
        const [activeTab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (!activeTab) return { success: false, error: "无法获取当前标签页" };
        const screenshotData = await safeCaptureVisibleTab();
        // 通过 content script 执行截图选区，确认后直接下载
        const msg = {
          type: "START_SCREENSHOT_SELECTION",
          data: screenshotData,
        };
        try {
          await chrome.tabs.sendMessage(activeTab.id, msg);
        } catch {
          // content script 未注入或已失效，清理旧 DOM 后重新注入
          await chrome.scripting.executeScript({
            target: { tabId: activeTab.id },
            func: () => {
              document.getElementById("doudou-floating-btn")?.remove();
            },
          });
          await chrome.scripting.executeScript({
            target: { tabId: activeTab.id },
            files: ["src/floating-btn.js"],
          });
          await new Promise((r) => setTimeout(r, 200));
          await chrome.tabs.sendMessage(activeTab.id, msg);
        }
        return { success: true };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }
    case "DOWNLOAD_SCREENSHOT": {
      try {
        const dataUrl = request.data;
        const tab =
          request.tab ||
          (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
        const hostname = tab?.url ? new URL(tab.url).hostname : "page";
        const now = new Date();
        const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
        const filename = `screenshot_${hostname}_${dateStr}.png`;
        await chrome.downloads.download({
          url: dataUrl,
          filename: filename,
          saveAs: false,
        });
        return { success: true };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }
    case "DOUDOU_DOWNLOAD_MEDIA": {
      try {
        await chrome.downloads.download({
          url: request.url,
          filename: request.filename,
          saveAs: false,
        });
        return { success: true };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }
    case "OPEN_TAB": {
      try {
        if (request.url) {
          await chrome.tabs.create({ url: request.url });
          return { success: true };
        }
        return { success: false, error: "未指定URL" };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }
    case "DOUDOU_TRANSLATE_PAGE": {
      try {
        const activeTab =
          sender.tab ||
          (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
        if (activeTab?.id) {
          await chrome.scripting.executeScript({
            target: { tabId: activeTab.id, allFrames: true },
            func: () =>
              document.dispatchEvent(new CustomEvent("DOUDOU_TRANSLATE_PAGE")),
          });
        }
        return { success: true };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }
    default:
      return { error: "Unknown message type" };
  }
}

// 处理豆豆浮窗按钮操作
async function handleDoudouBtnAction(action, tab) {
  if (!tab?.id) return { error: "无法获取当前标签页" };

  switch (action) {
    case "screenshot":
      await chrome.debugger.attach({ tabId: tab.id }, "1.3");
      try {
        // Scroll to bottom to ensure full page content is loaded
        await chrome.debugger.sendCommand(
          { tabId: tab.id },
          "Runtime.evaluate",
          {
            expression:
              "window.scrollTo(0, Math.max(document.body ? document.body.scrollHeight : 0, document.documentElement ? document.documentElement.scrollHeight : 0))",
            awaitPromise: true,
          },
        );

        // Small delay to let page settle after scroll
        await new Promise((resolve) => setTimeout(resolve, 300));

        // Scroll back to top before capturing
        await chrome.debugger.sendCommand(
          { tabId: tab.id },
          "Runtime.evaluate",
          {
            expression: "window.scrollTo(0, 0)",
            awaitPromise: true,
          },
        );

        // Wait for scroll to complete
        await new Promise((resolve) => setTimeout(resolve, 200));

        // Get layout metrics (use cssContentSize in CSS pixels to prevent high-DPI scaling issues)
        const metrics = await chrome.debugger.sendCommand(
          { tabId: tab.id },
          "Page.getLayoutMetrics",
        );

        const cssSize = metrics.cssContentSize || metrics.cssLayoutViewport;
        let width = cssSize ? cssSize.width || cssSize.clientWidth : 0;
        let height = cssSize ? cssSize.height || cssSize.clientHeight : 0;

        if (!width || !height) {
          const evalResult = await chrome.debugger.sendCommand(
            { tabId: tab.id },
            "Runtime.evaluate",
            {
              expression: `(() => {
                const body = document.body;
                const html = document.documentElement;
                return {
                  width: Math.max(
                    body ? body.scrollWidth : 0,
                    body ? body.offsetWidth : 0,
                    html ? html.clientWidth : 0,
                    html ? html.scrollWidth : 0,
                    html ? html.offsetWidth : 0
                  ),
                  height: Math.max(
                    body ? body.scrollHeight : 0,
                    body ? body.offsetHeight : 0,
                    html ? html.clientHeight : 0,
                    html ? html.scrollHeight : 0,
                    html ? html.offsetHeight : 0
                  )
                };
              })()`,
              returnByValue: true,
            },
          );
          const domSize = evalResult?.result?.value;
          width = width || domSize?.width || 1280;
          height = height || domSize?.height || 800;
        }

        width = Math.ceil(width);
        height = Math.ceil(height);

        const { data } = await chrome.debugger.sendCommand(
          { tabId: tab.id },
          "Page.captureScreenshot",
          {
            format: "png",
            captureBeyondViewport: true,
            clip: { x: 0, y: 0, width, height, scale: 1 },
          },
        );
        const hostname = new URL(tab.url).hostname;
        const now = new Date();
        const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
        const filename = `screenshot_${hostname}_${dateStr}.png`;
        await chrome.downloads.download({
          url: `data:image/png;base64,${data}`,
          filename: filename,
          saveAs: false,
        });
        return { success: true };
      } finally {
        await chrome.debugger.detach({ tabId: tab.id });
      }

    case "export-cookies": {
      const pageUrl = tab.url || "";
      if (!pageUrl.startsWith("http"))
        return { error: "无法在此页面导出Cookies" };

      const { otherConfig } = await chrome.storage.sync.get(["otherConfig"]);
      const format = otherConfig?.cookieExportFormat || "netscape";
      const result = await getPageCookies(pageUrl, format);

      if (!result.success) throw new Error(result.error || "获取Cookies失败");
      if (result.count === 0)
        return { success: true, message: "当前页面没有Cookies" };

      const isJson = format === "object";
      const fileExt = isJson ? "json" : "txt";
      const cookieContent = isJson
        ? JSON.stringify(result.cookies, null, 2)
        : result.cookies;

      const hostname = new URL(pageUrl).hostname;
      const now = new Date();
      const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
      const filename = `cookies_${hostname}_${dateStr}.${fileExt}`;

      const bytes = new TextEncoder().encode(cookieContent);
      let binary = "";
      const chunkSize = 8192;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
      }
      const base64 = btoa(binary);
      const mimeType = isJson ? "application/json" : "text/plain";
      const dataUrl = `data:${mimeType};base64,${base64}`;
      await chrome.downloads.download({
        url: dataUrl,
        filename,
        saveAs: false,
      });
      return { success: true };
    }

    case "generate-qrcode": {
      const pageUrl = tab.url || "";
      if (!pageUrl.startsWith("http"))
        return { error: "无法为此页面生成二维码" };

      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (url) => {
          document.getElementById("doudou-qrcode-overlay")?.remove();
          const overlay = document.createElement("div");
          overlay.id = "doudou-qrcode-overlay";
          overlay.style.cssText =
            "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;";

          const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(url)}`;
          const modal = document.createElement("div");
          modal.style.cssText =
            "background:#fff;border-radius:12px;padding:24px;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,0.2);width:280px;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;";
          modal.innerHTML = `
            <div style="margin-bottom:16px;font-weight:500;color:#333;font-size:16px;line-height:1.4;text-align:center;width:100%;box-sizing:border-box;">扫码访问页面</div>
            <div style="display:flex;justify-content:center;align-items:center;width:100%;box-sizing:border-box;">
              <img src="${qrUrl}" alt="QR Code" style="display:block;margin:0 auto;width:200px;height:200px;border-radius:8px;background:#f5f5f5;box-sizing:border-box;" crossorigin="anonymous" />
            </div>
            <div style="margin-top:12px;font-size:12px;color:#999;word-break:break-all;max-height:40px;overflow:hidden;line-height:1.4;text-align:center;width:100%;box-sizing:border-box;">${url}</div>
            <div style="margin-top:16px;display:flex;gap:10px;justify-content:center;width:100%;box-sizing:border-box;">
              <button id="doudou-qr-close" style="padding:8px 16px;background:#f5f5f5;color:#666;border:none;border-radius:6px;cursor:pointer;font-size:14px;box-sizing:border-box;">关闭</button>
              <button id="doudou-qr-copy" style="padding:8px 16px;background:#52c41a;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;box-sizing:border-box;">复制</button>
              <button id="doudou-qr-download" style="padding:8px 16px;background:#1890ff;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;box-sizing:border-box;">下载</button>
            </div>
          `;
          overlay.appendChild(modal);
          document.body.appendChild(overlay);

          overlay.addEventListener("click", (e) => {
            if (e.target === overlay) overlay.remove();
          });
          document
            .getElementById("doudou-qr-close")
            .addEventListener("click", () => overlay.remove());
          document
            .getElementById("doudou-qr-copy")
            .addEventListener("click", async () => {
              const copyBtn = document.getElementById("doudou-qr-copy");
              try {
                const resp = await fetch(qrUrl);
                const blob = await resp.blob();
                const pngBlob =
                  blob.type === "image/png"
                    ? blob
                    : new Blob([blob], { type: "image/png" });
                await navigator.clipboard.write([
                  new ClipboardItem({ "image/png": pngBlob }),
                ]);
                copyBtn.innerText = "已复制";
                setTimeout(() => {
                  if (copyBtn) copyBtn.innerText = "复制";
                }, 1500);
              } catch (err) {
                try {
                  const img = modal.querySelector("img");
                  const canvas = document.createElement("canvas");
                  canvas.width = img.naturalWidth || 200;
                  canvas.height = img.naturalHeight || 200;
                  const ctx = canvas.getContext("2d");
                  ctx.drawImage(img, 0, 0);
                  const b = await new Promise((res) =>
                    canvas.toBlob(res, "image/png")
                  );
                  await navigator.clipboard.write([
                    new ClipboardItem({ "image/png": b }),
                  ]);
                  copyBtn.innerText = "已复制";
                  setTimeout(() => {
                    if (copyBtn) copyBtn.innerText = "复制";
                  }, 1500);
                } catch (e) {
                  copyBtn.innerText = "复制失败";
                  setTimeout(() => {
                    if (copyBtn) copyBtn.innerText = "复制";
                  }, 1500);
                }
              }
            });
          document
            .getElementById("doudou-qr-download")
            .addEventListener("click", async () => {
              try {
                const resp = await fetch(qrUrl);
                const blob = await resp.blob();
                const hostname = new URL(url).hostname;
                const a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                a.download = `qrcode_${hostname}.png`;
                a.click();
                URL.revokeObjectURL(a.href);
              } catch {}
            });
        },
        args: [pageUrl],
      });
      return { success: true };
    }

    case "inspect-markdown": {
      const pageUrl = tab.url || "";
      if (!pageUrl.startsWith("http"))
        return { error: "无法在此页面选取元素" };

      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: [
          "lib/turndown.js",
          "src/utils/turndown-rules.js",
          "src/utils/element-picker.js",
        ],
      });
      return { success: true };
    }

    default:
      return { error: "未知操作" };
  }
}

/**
 * 获取当前页面的所有 Cookie
 * @param {string} url - 页面 URL
 * @param {string} format - 输出格式: 'netscape', 'object', 'header', 'detailed', 'raw'
 * @returns {Object} Cookie 数据
 */
async function getPageCookies(url, format = "raw") {
  try {
    if (!url) {
      return { success: false, error: "URL is required" };
    }

    // 获取该 URL 对应的所有 cookies
    const cookies = await chrome.cookies.getAll({ url });

    if (!cookies || cookies.length === 0) {
      return {
        success: true,
        cookies: format === "object" ? {} : format === "raw" ? [] : "",
        count: 0,
      };
    }

    let result;
    switch (format) {
      case "netscape":
        // Netscape Cookie File 格式字符串
        result = cookiesToNetscapeFile(cookies);
        break;
      case "object":
        // 简单的 {name: value} 对象
        result = cookiesToObject(cookies);
        break;
      case "header":
        // Cookie header 格式字符串: "name1=value1; name2=value2"
        result = cookiesToHeaderString(cookies);
        break;
      case "detailed":
        // 详细的对象数组
        result = cookiesToDetailedArray(cookies);
        break;
      case "raw":
      default:
        // 原始的 chrome.cookies.Cookie 数组
        result = cookies;
        break;
    }

    return {
      success: true,
      cookies: result,
      count: cookies.length,
      url: url,
      format: format,
    };
  } catch (error) {
    console.error("[豆豆] 获取 Cookie 失败:", error);
    return { success: false, error: error.message };
  }
}

// 安装时初始化
chrome.runtime.onInstalled.addListener(() => {
  restoreCorsRules();
});

chrome.runtime.onStartup.addListener(() => {
  restoreCorsRules();
});

// ==================== CORS Unblock 逻辑 ====================

const DEFAULT_CORS_EFFECTIVE_URLS = ["undsky.com"];

const DEFAULT_CORS_CONFIG = {
  enabled: false,
  allowOrigin: true,
  allowMethods: true,
  allowHeaders: true,
  allowCredentials: false,
  exposeHeaders: true,
  noOverwrite: false,
  removeCSP: false,
  removeXFrame: false,
  sharedArrayBuffer: false,
  removeRefererOrigin: false,
  fixRedirect: false,
  effectiveUrls: DEFAULT_CORS_EFFECTIVE_URLS,
};

// CORS 规则 ID 范围 (避免与其他规则冲突)
const CORS_RULE_ID_START = 9000;
const CORS_RULE_ID_END = 9999;
const CORS_SUBRESOURCE_TYPES = [
  "sub_frame",
  "stylesheet",
  "script",
  "image",
  "font",
  "object",
  "xmlhttprequest",
  "ping",
  "csp_report",
  "media",
  "websocket",
  "webtransport",
  "webbundle",
  "other",
];

let corsRefreshTimer = null;

function normalizeCorsEffectiveUrls(urls) {
  const values = Array.isArray(urls) ? urls : DEFAULT_CORS_EFFECTIVE_URLS;
  const normalized = [];
  const seen = new Set();

  for (const value of values) {
    const raw = String(value || "").trim();
    if (!raw) continue;

    let url;
    try {
      url = new URL(raw);
      // 完整 URL 模式：必须是 http/https
      if (url.protocol !== "http:" && url.protocol !== "https:") continue;
      const normalizedUrl = raw.split("#")[0];
      if (!seen.has(normalizedUrl)) {
        seen.add(normalizedUrl);
        normalized.push(normalizedUrl);
      }
    } catch {
      // 域名模式：不需要协议，直接保存
      if (!seen.has(raw)) {
        seen.add(raw);
        normalized.push(raw);
      }
    }
  }

  return normalized.length > 0 ? normalized : [...DEFAULT_CORS_EFFECTIVE_URLS];
}

function normalizeCorsConfig(config = {}) {
  return {
    ...DEFAULT_CORS_CONFIG,
    ...config,
    allowCredentials: false,
    noOverwrite: false,
    fixRedirect: false,
    effectiveUrls: normalizeCorsEffectiveUrls(config.effectiveUrls),
  };
}

function isCorsEffectiveUrl(tabUrl, effectiveUrls) {
  if (!tabUrl) return false;

  let tabUrlObj;
  try {
    tabUrlObj = new URL(tabUrl);
    if (tabUrlObj.protocol !== "http:" && tabUrlObj.protocol !== "https:") return false;
  } catch {
    return false;
  }

  return effectiveUrls.some((effectiveUrl) => {
    let matchUrlObj;
    try {
      // 尝试解析为完整 URL
      matchUrlObj = new URL(effectiveUrl);
    } catch {
      // 如果不是完整 URL，视为域名模式匹配
      const domain = effectiveUrl.trim();
      if (!domain) return false;

      // 域名匹配：支持任意子域名、端口、路径
      // 例如：undsky.com 匹配 https://api.undsky.com:8080/path
      const tabHost = tabUrlObj.hostname;

      // 完全匹配或作为子域名
      if (tabHost === domain || tabHost.endsWith('.' + domain)) {
        return true;
      }

      return false;
    }

    // 如果是完整 URL，执行原有的精确匹配逻辑
    tabUrlObj.hash = "";
    const normalizedTabUrl = tabUrlObj.toString();
    matchUrlObj.hash = "";
    const normalizedMatchUrl = matchUrlObj.toString();

    if (normalizedTabUrl === normalizedMatchUrl) return true;
    if (normalizedMatchUrl.endsWith("/")) return normalizedTabUrl.startsWith(normalizedMatchUrl);
    if (!normalizedTabUrl.startsWith(normalizedMatchUrl)) return false;
    const nextChar = normalizedTabUrl.charAt(normalizedMatchUrl.length);
    return nextChar === "/" || nextChar === "?" || nextChar === "";
  });
}

async function getCorsEffectiveTabIds(effectiveUrls) {
  const tabs = await chrome.tabs.query({});
  return tabs
    .filter((tab) => isCorsEffectiveUrl(tab.url, effectiveUrls))
    .map((tab) => tab.id)
    .filter((id) => Number.isInteger(id));
}

function makeCorsUrlFilter(url) {
  try {
    // 尝试解析为完整 URL
    new URL(url);
    // 如果成功，说明是完整 URL，使用精确匹配
    return `|${url}`;
  } catch {
    // 如果失败，说明是域名模式，使用域名匹配
    // 例如：undsky.com -> ||undsky.com
    return `||${url}`;
  }
}

async function getCorsRuleIds() {
  const [dynamicRules, sessionRules] = await Promise.all([
    chrome.declarativeNetRequest.getDynamicRules(),
    chrome.declarativeNetRequest.getSessionRules(),
  ]);

  const inCorsRange = (rule) =>
    rule.id >= CORS_RULE_ID_START && rule.id <= CORS_RULE_ID_END;

  return {
    dynamicRuleIds: dynamicRules.filter(inCorsRange).map((rule) => rule.id),
    sessionRuleIds: sessionRules.filter(inCorsRange).map((rule) => rule.id),
  };
}

async function getCorsStatus() {
  const { corsConfig } = await chrome.storage.local.get("corsConfig");
  const config = { ...DEFAULT_CORS_CONFIG, ...corsConfig };
  const effectiveConfig = normalizeCorsConfig(config);
  const { dynamicRuleIds, sessionRuleIds } = await getCorsRuleIds();

  return {
    config,
    effectiveConfig,
    active: dynamicRuleIds.length + sessionRuleIds.length > 0,
    credentialsSupported: false,
  };
}

/**
 * 从 storage 恢复 CORS 规则
 */
async function restoreCorsRules() {
  try {
    const { corsConfig } = await chrome.storage.local.get("corsConfig");
    if (corsConfig?.enabled) {
      await updateCorsRules(corsConfig);
      console.log("[豆豆] CORS Unblock 已恢复");
    }
  } catch (error) {
    console.error("[豆豆] 恢复 CORS 规则失败:", error);
  }
}

async function refreshCorsRulesFromStorage() {
  const { corsConfig } = await chrome.storage.local.get("corsConfig");
  if (corsConfig?.enabled) {
    await updateCorsRules(corsConfig);
  }
}

function scheduleCorsRulesRefresh() {
  clearTimeout(corsRefreshTimer);
  corsRefreshTimer = setTimeout(() => {
    refreshCorsRulesFromStorage().catch((error) => {
      console.error("[豆豆] 刷新 CORS 规则失败:", error);
    });
  }, 100);
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url || changeInfo.status === "loading") {
    scheduleCorsRulesRefresh();
  }
});

chrome.tabs.onRemoved.addListener(() => {
  scheduleCorsRulesRefresh();
});

/**
 * 根据配置更新 CORS 动态规则
 * @param {Object} config - CORS 配置对象
 */
async function updateCorsRules(config) {
  try {
    const effectiveConfig = normalizeCorsConfig(config);
    const { dynamicRuleIds, sessionRuleIds } = await getCorsRuleIds();

    if (!effectiveConfig.enabled) {
      await Promise.all([
        chrome.declarativeNetRequest.updateDynamicRules({
          removeRuleIds: dynamicRuleIds,
        }),
        chrome.declarativeNetRequest.updateSessionRules({
          removeRuleIds: sessionRuleIds,
        }),
      ]);
      console.log("[豆豆] CORS Unblock 已禁用");
      return {
        active: false,
        effectiveConfig,
        credentialsSupported: false,
      };
    }

    const dynamicRules = [];
    const sessionRules = [];
    let ruleId = CORS_RULE_ID_START;
    const matchedTabIds = await getCorsEffectiveTabIds(effectiveConfig.effectiveUrls);

    const nextRuleId = () => {
      if (ruleId > CORS_RULE_ID_END) {
        throw new Error("CORS 规则数量超出限制");
      }
      return ruleId++;
    };

    const addMainFrameRules = (action) => {
      for (const url of effectiveConfig.effectiveUrls) {
        dynamicRules.push({
          id: nextRuleId(),
          priority: 1,
          action,
          condition: {
            urlFilter: makeCorsUrlFilter(url),
            resourceTypes: ["main_frame"],
          },
        });
      }
    };

    const addTabScopedRule = (action, resourceTypes) => {
      if (matchedTabIds.length === 0) return;
      sessionRules.push({
        id: nextRuleId(),
        priority: 1,
        action,
        condition: {
          urlFilter: "*",
          tabIds: matchedTabIds,
          resourceTypes,
        },
      });
    };

    const responseHeaderActions = [];

    if (effectiveConfig.allowOrigin) {
      responseHeaderActions.push({
        header: "Access-Control-Allow-Origin",
        operation: "set",
        value: "*",
      });
    }

    if (effectiveConfig.allowMethods) {
      responseHeaderActions.push({
        header: "Access-Control-Allow-Methods",
        operation: "set",
        value:
          "GET, PUT, POST, DELETE, HEAD, OPTIONS, PATCH, PROPFIND, PROPPATCH, MKCOL, COPY, MOVE, LOCK",
      });
    }

    if (effectiveConfig.allowHeaders) {
      responseHeaderActions.push({
        header: "Access-Control-Allow-Headers",
        operation: "set",
        value: "*",
      });
    }

    if (effectiveConfig.exposeHeaders) {
      responseHeaderActions.push({
        header: "Access-Control-Expose-Headers",
        operation: "set",
        value: "*",
      });
    }

    responseHeaderActions.push({
      header: "Access-Control-Max-Age",
      operation: "set",
      value: "86400",
    });

    if (responseHeaderActions.length > 0) {
      const action = {
        type: "modifyHeaders",
        responseHeaders: responseHeaderActions,
      };
      addMainFrameRules(action);
      addTabScopedRule(action, CORS_SUBRESOURCE_TYPES);
    }

    if (effectiveConfig.removeCSP) {
      const cspHeaders = [
        "Content-Security-Policy",
        "Content-Security-Policy-Report-Only",
        "X-WebKit-CSP",
        "X-Content-Security-Policy",
      ];
      const action = {
        type: "modifyHeaders",
        responseHeaders: cspHeaders.map((header) => ({
          header,
          operation: "remove",
        })),
      };

      addMainFrameRules(action);
      addTabScopedRule(action, ["sub_frame"]);
    }

    if (effectiveConfig.removeXFrame) {
      const action = {
        type: "modifyHeaders",
        responseHeaders: [
          {
            header: "X-Frame-Options",
            operation: "remove",
          },
        ],
      };

      addMainFrameRules(action);
      addTabScopedRule(action, ["sub_frame"]);
    }

    if (effectiveConfig.sharedArrayBuffer) {
      addMainFrameRules({
        type: "modifyHeaders",
        responseHeaders: [
          {
            header: "Cross-Origin-Opener-Policy",
            operation: "set",
            value: "same-origin",
          },
          {
            header: "Cross-Origin-Embedder-Policy",
            operation: "set",
            value: "require-corp",
          },
        ],
      });
    }

    if (effectiveConfig.removeRefererOrigin) {
      const action = {
        type: "modifyHeaders",
        requestHeaders: [
          {
            header: "Referer",
            operation: "remove",
          },
          {
            header: "Origin",
            operation: "remove",
          },
        ],
      };

      addMainFrameRules(action);
      addTabScopedRule(action, ["sub_frame", "xmlhttprequest", "other"]);
    }

    await Promise.all([
      chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: dynamicRuleIds,
        addRules: dynamicRules,
      }),
      chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: sessionRuleIds,
        addRules: sessionRules,
      }),
    ]);

    console.log(
      `[豆豆] CORS Unblock 已启用，共 ${dynamicRules.length + sessionRules.length} 条规则，匹配 ${matchedTabIds.length} 个标签页`,
    );
    return {
      active: dynamicRules.length + sessionRules.length > 0,
      effectiveConfig,
      credentialsSupported: false,
    };
  } catch (error) {
    console.error("[豆豆] 更新 CORS 规则失败:", error);
    throw error;
  }
}

// ============ 右键菜单：翻译 ============
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "doudou-translate-page",
      title: "🌐 翻译页面",
      contexts: ["page"],
    });
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;

  if (info.menuItemId === "doudou-translate-page") {
    // 不能往 chrome://, chrome-extension://, edge:// 等受限页面注入脚本
    const url = tab.url || "";
    if (!/^https?:\/\//.test(url)) {
      console.warn("[豆豆] 当前页面不支持翻译:", url);
      return;
    }
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        func: () =>
          document.dispatchEvent(new CustomEvent("DOUDOU_TRANSLATE_PAGE")),
      });
    } catch (err) {
      console.error("[豆豆] 右键翻译页面失败:", err);
    }
  }
});
