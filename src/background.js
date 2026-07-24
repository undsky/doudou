// Cookie 工具
import {
  cookiesToNetscapeFile,
  cookiesToObject,
  cookiesToHeaderString,
  cookiesToDetailedArray,
} from "./utils/cookie.js";

// OpenAI 客户端
import { OpenAIClient } from "./ai/openai.js";

import { safeCaptureVisibleTab } from "./utils/capture.js";

// LLM 输出清理工具
function cleanLLMOutput(text) {
  if (!text) return text;
  let cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  cleaned = cleaned.replace(/<think>[\s\S]*$/gi, "");
  return cleaned.trim();
}

// 豆豆处理的消息类型
const DOUDOU_MESSAGE_TYPES = new Set([
  "CRAWLER_SELECTOR_RESULT",
  "CRAWLER_SELECTOR_CANCELLED",
  "GET_PAGE_COOKIES",
  "CORS_UPDATE_CONFIG",
  "GET_CORS_STATUS",
  "DOUDOU_BTN_ACTION",
  "TOGGLE_SIDE_PANEL",
  "OPEN_SIDE_PANEL",
  "ASK_AI",
  "SUMMARIZE_PAGE_ACTION",
  "GET_SIDEPANEL_STATUS",
  "SIDEPANEL_CAPTURE_SCREENSHOT",
  "SIDEPANEL_GET_PAGE_CONTENT",
  "SCREENSHOT_RESULT",
  "POPUP_CAPTURE_SCREENSHOT",
  "DOWNLOAD_SCREENSHOT",
  "VOICE_START",
  "VOICE_STOP",
  "VOICE_RESULT",
  "VOICE_ERROR",
  "VOICE_END",
  "DOUDOU_TRANSLATE_PAGE",
]);

// 消息监听 - 豆豆优先处理
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // 豆豆消息类型由豆豆处理
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
  // 非豆豆消息类型，不处理，让 COSE 处理
  return false;
});

// COSE 多平台文章同步 - 在豆豆监听器注册后导入
import "../bundles/background.js";

// Side Panel 状态追踪
let sidePanelPort = null;

// 长连接监听(流式对话 + side panel 状态)
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "doudou-sidepanel") {
    sidePanelPort = port;
    port.onDisconnect.addListener(async () => {
      sidePanelPort = null;
      // 通知当前标签页侧边栏已关闭，头像恢复位置
      try {
        const [tab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (tab?.id)
          chrome.tabs.sendMessage(
            tab.id,
            { type: "SIDEPANEL_CLOSED" },
            () => void chrome.runtime.lastError,
          );
      } catch {}
    });
    return;
  }
  if (port.name !== "doudou-chat") return;

  let disconnected = false;
  port.onDisconnect.addListener(() => {
    disconnected = true;
  });

  port.onMessage.addListener(async (msg) => {
    if (msg.type !== "DOUDOU_CHAT_STREAM") return;

    try {
      // 根据传入的 configType 获取对应配置
      const configType = msg.configType || "dialog"; // 默认使用对话模型
      const configId = msg.configId; // 侧边栏传递的指定配置ID
      const { openaiConfigs } = await chrome.storage.sync.get(["openaiConfigs"]);

      console.log(`[豆豆] 收到聊天请求，configType: ${configType}, configId: ${configId || "未指定"}`);
      console.log(`[豆豆] 当前配置列表:`, openaiConfigs?.map(c => ({ name: c.name, type: c.type, id: c.id })));

      let config = null;
      if (openaiConfigs && openaiConfigs.length > 0) {
        // 1. 如果指定了配置ID，优先使用指定的配置
        if (configId) {
          config = openaiConfigs.find(c => c.id === configId);
          if (config) {
            console.log(`[豆豆] 使用指定配置ID: ${config.name} (ID: ${config.id})`);
          }
        }

        // 2. 如果没有指定ID或ID未找到，按类型匹配
        if (!config) {
          config = openaiConfigs.find(c => c.type === configType);
          if (config) {
            console.log(`[豆豆] 按类型匹配配置: ${config.name} (类型: ${config.type})`);
          }
        }

        // 3. 如果都没找到，使用第一个配置兜底
        if (!config) {
          console.log(`[豆豆] 未找到类型为 "${configType}" 的配置，使用第一个配置兜底`);
          config = openaiConfigs[0];
        }
      }

      if (!config || !config.openaiApiKey) {
        console.error("[豆豆] 配置错误: 未找到有效的 API Key");
        port.postMessage({
          type: "error",
          data: "请先在「设置」页面配置 OpenAI API Key",
        });
        return;
      }

      const client = new OpenAIClient({
        apiKey: config.openaiApiKey,
        baseURL: config.openaiBaseUrl || "https://api.openai.com/v1",
        model: config.openaiModel || "gpt-4o",
      });

      console.log(`[豆豆] 使用配置: ${config.name}`);
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
        reader.cancel();
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
            await reader.cancel();
            break;
          }
        } catch {}
      }
    }
  } catch (err) {
    if (!isDisconnected()) throw err;
  }
}

// 清理页面内所有选择器实例（因为注入时用了 allFrames: true，取消时需全局清理）
async function cleanupAllSelectors(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => {
        if (window.__crawlerSelector) window.__crawlerSelector.destroy();
        if (window.__imageReplicationSelector)
          window.__imageReplicationSelector.destroy();
      },
    });
  } catch (err) {}
}

async function handleMessage(request, sender) {
  switch (request.type) {
    case "CRAWLER_SELECTOR_RESULT":
      cleanupAllSelectors(sender.tab.id);
      const { selector_mode } = await chrome.storage.local.get("selector_mode");
      if (selector_mode === "article_replication") {
        await chrome.storage.local.remove("selector_mode");
        return await handleArticleReplication(
          request.data,
          sender.tab.id,
          sender.frameId,
        );
      }
      return { success: true };
    case "CRAWLER_SELECTOR_CANCELLED":
      // 用户取消选择，清理所有 iframe 内的选择器
      cleanupAllSelectors(sender.tab.id);
      return { success: true };
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
    case "TOGGLE_SIDE_PANEL": {
      const windowId =
        sender?.tab?.windowId ??
        (await chrome.tabs.query({ active: true, currentWindow: true }))[0]
          ?.windowId;
      if (windowId == null) return { success: false, error: "无法获取窗口" };
      if (sidePanelPort) {
        // 已打开 → 关闭：先禁用再恢复
        await chrome.sidePanel.setOptions({ enabled: false });
        await chrome.sidePanel.setOptions({
          enabled: true,
          path: "src/sidepanel.html",
        });
      } else {
        await chrome.sidePanel.open({ windowId });
      }
      return { success: true };
    }
    case "OPEN_SIDE_PANEL": {
      const windowId =
        sender?.tab?.windowId ??
        (await chrome.tabs.query({ active: true, currentWindow: true }))[0]
          ?.windowId;
      if (windowId == null) return { success: false, error: "无法获取窗口" };
      await chrome.sidePanel.open({ windowId });
      return { success: true };
    }
    case "ASK_AI": {
      const windowId =
        sender?.tab?.windowId ??
        (await chrome.tabs.query({ active: true, currentWindow: true }))[0]
          ?.windowId;
      if (windowId == null) return { success: false, error: "无法获取窗口" };
      const wasOpen = !!sidePanelPort;
      await chrome.sidePanel.open({ windowId });
      if (!wasOpen) {
        await new Promise((resolve) => {
          const check = () =>
            sidePanelPort ? resolve() : setTimeout(check, 50);
          check();
        });
        // 新面板需要等待 DOM 渲染
        await new Promise((r) => setTimeout(r, 500));
      }
      sidePanelPort.postMessage({ type: "ASK_AI", data: request.data });
      return { success: true };
    }
    case "SUMMARIZE_PAGE_ACTION": {
      const activeTab2 =
        sender?.tab ??
        (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
      if (!activeTab2?.id)
        return { success: false, error: "无法获取当前标签页" };
      const windowId2 = activeTab2.windowId;
      // 先打开侧边栏（保持用户手势上下文）
      const wasOpen2 = !!sidePanelPort;
      await chrome.sidePanel.open({ windowId: windowId2 });
      // 注入 TurndownService 并提取页面内容
      const pageData2 = await getPageMarkdown(activeTab2.id);
      // 等待侧边栏就绪
      if (!wasOpen2) {
        await new Promise((resolve) => {
          const check = () =>
            sidePanelPort ? resolve() : setTimeout(check, 50);
          check();
        });
        await new Promise((r) => setTimeout(r, 500));
      }
      sidePanelPort.postMessage({ type: "SUMMARIZE_PAGE", data: pageData2 });
      return { success: true };
    }
    case "GET_SIDEPANEL_STATUS":
      return { open: !!sidePanelPort };
    case "SIDEPANEL_CAPTURE_SCREENSHOT": {
      try {
        const [activeTab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (!activeTab) return { success: false, error: "无法获取当前标签页" };
        const tabUrl = activeTab.url || "";
        if (!tabUrl.startsWith("http://") && !tabUrl.startsWith("https://")) {
          return { success: false, error: "请切换到一个普通网页后再使用截图" };
        }
        const screenshotData = await safeCaptureVisibleTab();
        // 通过 content script 执行截图选区，然后将结果传回 side panel
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
          // 等待 content script 初始化完成
          await new Promise((r) => setTimeout(r, 200));
          await chrome.tabs.sendMessage(activeTab.id, msg);
        }
        return { success: true };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }
    case "SIDEPANEL_GET_PAGE_CONTENT": {
      try {
        const [activeTab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (!activeTab) return { success: false, error: "无法获取当前标签页" };
        const data = await getPageMarkdown(activeTab.id);
        return { success: true, data };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }
    case "SCREENSHOT_RESULT": {
      // 将截图结果转发给 side panel
      if (sidePanelPort) {
        sidePanelPort.postMessage({
          type: "SCREENSHOT_RESULT",
          data: request.data,
        });
      }
      return { success: true };
    }
    case "POPUP_CAPTURE_SCREENSHOT": {
      try {
        const [activeTab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (!activeTab) return { success: false, error: "无法获取当前标签页" };
        const screenshotData = await safeCaptureVisibleTab();
        // 通过 content script 执行截图选区，mode=download 表示确认后直接下载
        const msg = {
          type: "START_SCREENSHOT_SELECTION",
          data: screenshotData,
          mode: "download",
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
    case "VOICE_START": {
      try {
        const [activeTab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (!activeTab?.id)
          return { success: false, error: "无法获取当前标签页" };
        const tabUrl = activeTab.url || "";
        if (!tabUrl.startsWith("http://") && !tabUrl.startsWith("https://")) {
          return {
            success: false,
            error: "请切换到一个普通网页后再使用语音输入",
          };
        }
        await chrome.scripting.executeScript({
          target: { tabId: activeTab.id },
          func: () => {
            if (window._doudouVoiceRec) {
              window._doudouVoiceRec.abort();
              window._doudouVoiceRec = null;
            }
            const SR =
              window.SpeechRecognition || window.webkitSpeechRecognition;
            if (!SR) {
              chrome.runtime.sendMessage({
                type: "VOICE_ERROR",
                error: "浏览器不支持语音识别",
              });
              return;
            }
            const rec = new SR();
            rec.lang = "zh-CN";
            rec.interimResults = true;
            rec.continuous = true;
            window._doudouVoiceRec = rec;
            let finalText = "";
            rec.onresult = (e) => {
              let interim = "";
              for (let i = e.resultIndex; i < e.results.length; i++) {
                const t = e.results[i][0].transcript;
                if (e.results[i].isFinal) finalText += t;
                else interim += t;
              }
              chrome.runtime.sendMessage({
                type: "VOICE_RESULT",
                final: finalText,
                interim,
              });
            };
            rec.onerror = (e) => {
              if (e.error === "aborted" || e.error === "no-speech") return;
              chrome.runtime.sendMessage({
                type: "VOICE_ERROR",
                error: e.error,
              });
              window._doudouVoiceRec = null;
            };
            rec.onend = () => {
              if (window._doudouVoiceRec === rec) {
                try {
                  rec.start();
                } catch (_) {
                  window._doudouVoiceRec = null;
                  chrome.runtime.sendMessage({ type: "VOICE_END" });
                }
              }
            };
            rec.start();
          },
        });
        return { success: true };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }
    case "VOICE_STOP": {
      try {
        const [activeTab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (activeTab?.id) {
          await chrome.scripting.executeScript({
            target: { tabId: activeTab.id },
            func: () => {
              if (window._doudouVoiceRec) {
                window._doudouVoiceRec.abort();
                window._doudouVoiceRec = null;
              }
            },
          });
        }
      } catch {}
      return { success: true };
    }
    case "VOICE_RESULT":
    case "VOICE_ERROR":
    case "VOICE_END": {
      if (sidePanelPort) {
        sidePanelPort.postMessage(request);
      }
      return { success: true };
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

// 注入 TurndownService 并提取页面 Markdown 内容
async function getPageMarkdown(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ["md/static/js/turndown.js", "src/utils/turndown-rules.js"],
    });
  } catch (err) {
    console.error("[豆豆] 注入 turndown 报错(可能部分 frame 被拦截):", err);
  }

  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: () => {
      const title = document.title || "";
      const url = location.href || "";
      // 移除噪音元素后提取正文
      const clone = document.body.cloneNode(true);
      const noiseTags = ["SCRIPT", "STYLE", "NOSCRIPT", "SVG", "IFRAME"];
      for (const tag of noiseTags) {
        clone.querySelectorAll(tag).forEach((el) => el.remove());
      }
      const noiseSelectors = [
        "[role=navigation]",
        "[role=banner]",
        "[role=contentinfo]",
        "[aria-hidden=true]",
      ];
      for (const sel of noiseSelectors) {
        clone.querySelectorAll(sel).forEach((el) => el.remove());
      }
      // 移除豆豆插件自身的 DOM 元素
      clone
        .querySelectorAll("[id^='doudou-'], [data-doudou-translate]")
        .forEach((el) => el.remove());

      let md = "";
      if (typeof TurndownService !== "undefined") {
        const parser = new TurndownService();
        if (typeof addTurndownRules === "function") addTurndownRules(parser);
        md = parser.turndown(clone.innerHTML);
        // 压缩多余空行
        md = md.replace(/(\s*\n\s*){3,}/g, "\n\n").trim();
      }

      return { title, url, md };
    },
  });

  let baseTitle = "";
  let baseUrl = "";
  let finalMd = "";

  if (results && results.length > 0) {
    // 按返回结果合并所有 frame 的 Markdown 内容
    for (const res of results) {
      if (!res.result) continue;
      // frameId 为 0 通常是主框架
      if (res.frameId === 0) {
        baseTitle = res.result.title;
        baseUrl = res.result.url;
      }
      if (res.result.md) {
        if (finalMd) finalMd += "\n\n---\n\n";
        finalMd += res.result.md;
      }
    }
  }

  return `标题：${baseTitle}\n链接：${baseUrl}\n\n${finalMd}`;
}

// 处理豆豆浮窗按钮操作
async function handleDoudouBtnAction(action, tab) {
  if (!tab?.id) return { error: "无法获取当前标签页" };

  switch (action) {
    case "clone-article":
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        func: () => {
          window.__CRAWLER_AUTO_CONFIRM = true;
        },
      });
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        files: ["src/crawler-selector.js"],
      });
      await chrome.storage.local.set({ selector_mode: "article_replication" });
      return { success: true };

    case "screenshot":
      await chrome.debugger.attach({ tabId: tab.id }, "1.3");
      try {
        await chrome.debugger.sendCommand({ tabId: tab.id }, "Page.enable");
        const { contentSize } = await chrome.debugger.sendCommand(
          { tabId: tab.id },
          "Page.getLayoutMetrics",
        );
        const { width, height } = contentSize;

        // Scroll to bottom to ensure full page content is loaded
        await chrome.debugger.sendCommand(
          { tabId: tab.id },
          "Runtime.evaluate",
          {
            expression: "window.scrollTo(0, document.body.scrollHeight)",
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
      const base64 = btoa(String.fromCharCode(...bytes));
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
            "background:#fff;border-radius:12px;padding:24px;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,0.2);max-width:280px;";
          modal.innerHTML = `
            <div style="margin-bottom:16px;font-weight:500;color:#333;">扫码访问页面</div>
            <img src="${qrUrl}" alt="QR Code" style="width:200px;height:200px;border-radius:8px;background:#f5f5f5;" crossorigin="anonymous" />
            <div style="margin-top:12px;font-size:12px;color:#999;word-break:break-all;max-height:40px;overflow:hidden;">${url}</div>
            <div style="margin-top:16px;display:flex;gap:12px;justify-content:center;">
              <button id="doudou-qr-close" style="padding:8px 20px;background:#f5f5f5;color:#666;border:none;border-radius:6px;cursor:pointer;font-size:14px;">关闭</button>
              <button id="doudou-qr-download" style="padding:8px 20px;background:#1890ff;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;">下载</button>
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

const DEFAULT_PROMPT = `# 角色定义
你是一位资深的内容创作专家和文案策划师，擅长分析文章结构和创作吸引人的标题。

# 任务目标
请完成以下两项任务：
1. 仔细分析我提供的原文内容，理解其核心观点、写作风格和结构特点
2. 基于原文内容，生成一个吸引人的标题，要求新颖、精准且具有点击欲
3. 按照原文的风格、语气和逻辑结构，重新创作内容，保持核心信息一致但表达方式更优化

# 输出要求
## 格式规范
- 使用Markdown格式输出全部内容
- 文章标题使用H1格式（# 标题）
- 章节标题使用H2格式（## 章节标题）
- 小节标题使用H3格式（### 小节标题）
- 使用**粗体**突出关键词和重点信息
- 适当使用无序列表（-）或有序列表（1. 2. 3.）展示要点
- 段落之间用空行分隔，保持清晰的结构

## 内容要求
- 保持原文的核心观点和关键信息不变
- 优化语言表达，使其更流畅易读
- 每个段落控制在100-200字之间
- 适当添加过渡句，增强逻辑连贯性
- 保留重要数据、案例和引用

## 标题要求
生成3个备选标题，每个标题需要：
- 简洁有力（8-20字之间）
- 包含关键词
- 具有吸引力和点击欲
- 准确概括文章主题

# 输出示例结构
**推荐标题（3选1）：**
1. [标题选项1]
2. [标题选项2]
3. [标题选项3]

---

# [最终选定标题]

[文章导语/摘要]

## [第一部分标题]
[内容段落...]

## [第二部分标题]
[内容段落...]

## [总结部分]
[总结内容...]`;

// 处理文章复刻
async function handleArticleReplication(data, tabId, frameId = 0) {
  try {
    const target = { tabId };
    if (frameId !== 0 && frameId !== undefined) {
      target.frameIds = [frameId];
    }

    // 0. 显示 Loading
    await chrome.scripting.executeScript({
      target,
      func: () => {
        const overlay = document.createElement("div");
        overlay.id = "doudou-loading-overlay";
        overlay.style.cssText = `
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(0, 0, 0, 0.8);
          z-index: 2147483647;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        `;
        overlay.innerHTML = `
          <div style="margin-bottom: 20px;">
            <svg xmlns="http://www.w3.org/2000/svg" width="50" height="50" viewBox="0 0 24 24" fill="none" stroke="#1890ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="animation: spin 1s linear infinite;">
              <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
            </svg>
            <style>@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }</style>
          </div>
          <div style="font-size: 18px; color: #fff; font-weight: 500;" id="doudou-loading-text">提取页面内容中...</div>
          <div style="font-size: 14px; color: rgba(255, 255, 255, 0.8); margin-top: 10px;" id="doudou-loading-subtext"></div>
        `;
        document.body.appendChild(overlay);
      },
    });

    // 1. 注入 Turndown 工具和通用规则
    await chrome.scripting.executeScript({
      target,
      files: ["md/static/js/turndown.js", "src/utils/turndown-rules.js"],
    });

    // 2. 获取页面内容并转换为 Markdown
    const [{ result: markdown }] = await chrome.scripting.executeScript({
      target,
      func: (selector) => {
        if (typeof TurndownService === "undefined") {
          throw new Error("TurndownService 加载失败");
        }

        const parser = new TurndownService();
        addTurndownRules(parser);

        const targetEl = document.querySelector(selector);
        if (!targetEl) throw new Error("未找到选择的内容");

        return parser.turndown(targetEl.innerHTML);
      },
      args: [data.selector],
    });

    if (!markdown) throw new Error("内容提取失败，结果为空");

    // 3. 读取用户保存的提示词
    const { clone_article_prompt } = await chrome.storage.local.get(
      "clone_article_prompt",
    );
    const currentPrompt = clone_article_prompt || DEFAULT_PROMPT;

    // 4. 弹出提示词编辑窗口
    const [{ result: editedPrompt }] = await chrome.scripting.executeScript({
      target,
      func: (promptText) => {
        return new Promise((resolve) => {
          // 隐藏 loading
          const loadingOverlay = document.getElementById(
            "doudou-loading-overlay",
          );
          if (loadingOverlay) loadingOverlay.style.display = "none";

          const editorOverlay = document.createElement("div");
          editorOverlay.id = "doudou-prompt-editor-overlay";
          editorOverlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.6);
            z-index: 2147483647;
            display: flex;
            align-items: center;
            justify-content: center;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
          `;

          editorOverlay.innerHTML = `
            <div style="background: #fff; width: 600px; max-width: 90vw; border-radius: 8px; box-shadow: 0 4px 24px rgba(0,0,0,0.2); display: flex; flex-direction: column; overflow: hidden;">
              <div style="padding: 16px 24px; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center;">
                <h3 style="margin: 0; font-size: 18px; color: #333;">提示词</h3>
              </div>
              <div style="padding: 24px;">
                <textarea id="doudou-prompt-textarea" style="width: 100%; height: 350px; padding: 12px; border: 1px solid #d9d9d9; border-radius: 6px; resize: vertical; font-size: 14px; line-height: 1.6; font-family: inherit; outline: none; box-sizing: border-box;" spellcheck="false"></textarea>
              </div>
              <div style="padding: 16px 24px; border-top: 1px solid #eee; display: flex; justify-content: flex-end; gap: 12px; background: #fafafa;">
                <button id="doudou-prompt-cancel" style="padding: 8px 20px; border: 1px solid #d9d9d9; background: #fff; border-radius: 6px; cursor: pointer; color: #333; font-size: 14px;">取消</button>
                <button id="doudou-prompt-confirm" style="padding: 8px 20px; border: none; background: #1890ff; color: #fff; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 500;">开始复刻</button>
              </div>
            </div>
          `;

          document.body.appendChild(editorOverlay);

          const textarea = document.getElementById("doudou-prompt-textarea");
          textarea.value = promptText;

          document
            .getElementById("doudou-prompt-cancel")
            .addEventListener("click", () => {
              editorOverlay.remove();
              resolve(null);
            });

          document
            .getElementById("doudou-prompt-confirm")
            .addEventListener("click", () => {
              const finalPrompt = textarea.value.trim() || promptText;
              editorOverlay.remove();

              // 恢复显示 loading
              if (loadingOverlay) {
                loadingOverlay.style.display = "flex";
                document.getElementById("doudou-loading-text").textContent =
                  "AI 文章复刻中...";
                document.getElementById("doudou-loading-subtext").textContent =
                  "智能提取与重写大约需要 1 分钟，请耐心等待";
              }
              resolve(finalPrompt);
            });
        });
      },
      args: [currentPrompt],
    });

    if (!editedPrompt) {
      // 用户取消
      await chrome.scripting.executeScript({
        target,
        func: () => {
          const overlay = document.getElementById("doudou-loading-overlay");
          if (overlay) overlay.remove();
        },
      });
      return { success: false, error: "用户取消操作" };
    }

    // 保存最新提示词
    await chrome.storage.local.set({ clone_article_prompt: editedPrompt });

    // 5. 调用 OpenAI (传入 Markdown)
    const { openaiConfig } = await chrome.storage.sync.get(["openaiConfig"]);
    let finalMarkdown = markdown;

    if (openaiConfig?.openaiApiKey) {
      console.log("[豆豆] 正在调用 OpenAI 进行文章复刻...");
      const client = new OpenAIClient({
        apiKey: openaiConfig.openaiApiKey,
        baseURL: openaiConfig.openaiBaseUrl,
        model: openaiConfig.openaiModel,
      });

      const result = await client.chat(markdown, {
        systemPrompt: editedPrompt,
      });
      if (result) {
        finalMarkdown = cleanLLMOutput(result);
      }
    } else {
      console.warn("[豆豆] 未配置 OpenAI，将跳过 AI 处理");
    }

    // 4. 准备文章数据
    const newPostId = crypto.randomUUID();
    const now = new Date();
    const dateStr = now.toLocaleString("zh-cn");

    const newPost = {
      id: newPostId,
      title: dateStr,
      content: finalMarkdown,
      history: [{ datetime: dateStr, content: finalMarkdown }],
      createDatetime: now.toISOString(),
      updateDatetime: now.toISOString(),
      parentId: null,
    };

    // 5. 保存并打开编辑器
    await chrome.storage.local.set({ pending_post_import: newPost });
    console.log("[豆豆] 文章处理完成，正在打开编辑器...");

    // 移除 loading
    await chrome.scripting.executeScript({
      target,
      func: () => {
        const overlay = document.getElementById("doudou-loading-overlay");
        if (overlay) overlay.remove();
      },
    });

    chrome.tabs.create({
      url: chrome.runtime.getURL("md/index.html?source=background_import"),
    });

    return { success: true };
  } catch (error) {
    console.error("[豆豆] 文章复刻失败:", error);

    // 移除 loading 并报错
    chrome.scripting.executeScript({
      target,
      func: (msg) => {
        const overlay = document.getElementById("doudou-loading-overlay");
        if (overlay) overlay.remove();
        alert("文章复刻失败: " + msg);
      },
      args: [error.message],
    });
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
const CORS_RULE_ID_END = 9299;
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
