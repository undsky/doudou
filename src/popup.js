import { showToast } from "./utils/ui.js";
import { setCrawlerAutoConfirmTrue } from "./utils/inject-helpers.js";

const DEFAULT_CORS_EFFECTIVE_URLS = ["https://undsky.com/doudou_canvas"];

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

/**
 * Doudou Extension Popup Logic
 */

document.addEventListener("DOMContentLoaded", () => {
  const createArticleBtn = document.getElementById("create-article");
  const cloneArticleBtn = document.getElementById("clone-article");
  const settingsBtn = document.getElementById("settings");

  if (createArticleBtn) {
    createArticleBtn.addEventListener("click", () => {
      chrome.tabs.create({
        url: "md/index.html",
      });
    });
  }

  if (cloneArticleBtn) {
    cloneArticleBtn.addEventListener("click", handleCloneArticle);
  }

  if (settingsBtn) {
    settingsBtn.addEventListener("click", () => {
      chrome.tabs.create({
        url: "src/settings.html",
      });
    });
  }

  // 检查升级（异步，不阻塞页面）
  const upgradeBtn = document.getElementById("upgrade-btn");
  if (upgradeBtn) {
    fetch("https://www.undsky.com/v.json")
      .then((res) => res.json())
      .then((data) => {
        const currentVersion = chrome.runtime.getManifest().version;
        if (data.version && data.version !== currentVersion) {
          upgradeBtn.classList.remove("hidden");
          upgradeBtn.title = `发现新版本 ${data.version}，点击升级`;
        }
      })
      .catch(() => {});
  }

  // 豆豆按钮开关
  const doudouToggleInput = document.getElementById("doudou-toggle-input");
  if (doudouToggleInput) {
    chrome.storage.local.get("doudouBtnVisible", ({ doudouBtnVisible }) => {
      doudouToggleInput.checked = doudouBtnVisible !== false;
    });

    doudouToggleInput.addEventListener("change", () => {
      chrome.storage.local.set({ doudouBtnVisible: doudouToggleInput.checked });
    });

    // 实时同步：页面中关闭豆豆按钮时更新开关状态
    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (namespace === "local" && "doudouBtnVisible" in changes) {
        doudouToggleInput.checked = changes.doudouBtnVisible.newValue !== false;
      }
    });
  }

  // 侧边栏开关
  const sidebarToggleInput = document.getElementById("sidebar-toggle-input");
  if (sidebarToggleInput) {
    // 通过 port 检测 side panel 是否已打开（向 background 查询）
    chrome.runtime.sendMessage({ type: "GET_SIDEPANEL_STATUS" }, (res) => {
      void chrome.runtime.lastError;
      sidebarToggleInput.checked = !!res?.open;
    });

    sidebarToggleInput.addEventListener("change", async () => {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!tab) return;
      if (sidebarToggleInput.checked) {
        await chrome.sidePanel.open({ windowId: tab.windowId });
      } else {
        // 关闭：先禁用再恢复
        await chrome.sidePanel.setOptions({ enabled: false });
        await chrome.sidePanel.setOptions({
          enabled: true,
          path: "src/sidepanel.html",
        });
      }
    });
  }

  async function ensureCorsEnabled() {
    const statusRes = await chrome.runtime.sendMessage({
      type: "GET_CORS_STATUS",
    });
    const currentConfig = {
      ...DEFAULT_CORS_CONFIG,
      ...(statusRes?.config || {}),
    };

    if (currentConfig.enabled) return;

    const nextConfig = {
      ...currentConfig,
      enabled: true,
    };

    await chrome.storage.local.set({ corsConfig: nextConfig });

    const updateRes = await chrome.runtime.sendMessage({
      type: "CORS_UPDATE_CONFIG",
      config: nextConfig,
    });

    if (!updateRes?.success) {
      throw new Error(updateRes?.error || "开启 CORS 状态失败");
    }

    renderCorsStatus(true);
  }

  // AI 智能体平台
  const aiAgentPlatformBtn = document.getElementById("ai-agent-platform");
  if (aiAgentPlatformBtn) {
    aiAgentPlatformBtn.addEventListener("click", () => {
      chrome.tabs.create({
        url: "http://ai.undsky.com",
      });
    });
  }

  // AI 画布
  const infiniteCanvasBtn = document.getElementById("infinite-canvas");
  if (infiniteCanvasBtn) {
    infiniteCanvasBtn.addEventListener("click", async () => {
      try {
        await ensureCorsEnabled();
        chrome.tabs.create({
          url: "https://undsky.com/doudou_canvas",
        });
      } catch (error) {
        showToast("开启 CORS 失败: " + error.message, "error");
      }
    });
  }

  // AI图文创作
  const createImageTextBtn = document.getElementById("create-image-text");
  if (createImageTextBtn) {
    createImageTextBtn.addEventListener("click", () => {
      chrome.tabs.create({
        url: "src/image_text/index.html",
      });
    });
  }

  // 页面截图 - 子菜单
  const pageScreenshotBtn = document.getElementById("page-screenshot");
  const screenshotSubmenu = document.getElementById("screenshot-submenu");
  const screenshotFullBtn = document.getElementById("screenshot-full");
  const screenshotSelectBtn = document.getElementById("screenshot-select");

  if (pageScreenshotBtn && screenshotSubmenu) {
    // 点击切换子菜单
    pageScreenshotBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      screenshotSubmenu.classList.toggle("show");
    });

    // 点击外部关闭子菜单
    document.addEventListener("click", () => {
      screenshotSubmenu.classList.remove("show");
    });

    // 阻止子菜单内点击冒泡关闭
    screenshotSubmenu.addEventListener("click", (e) => {
      e.stopPropagation();
    });
  }

  // 整页截图
  if (screenshotFullBtn) {
    screenshotFullBtn.addEventListener("click", async () => {
      try {
        const [tab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });

        const url = tab.url || "";
        if (
          url.startsWith("chrome://") ||
          url.startsWith("chrome-extension://") ||
          url.startsWith("edge://") ||
          url.startsWith("about:") ||
          url.startsWith("file://") ||
          !url.startsWith("http")
        ) {
          showToast("无法在此页面截图，请在普通网页上使用", "error");
          return;
        }

        // 隐藏子菜单
        screenshotSubmenu.classList.remove("show");

        // 显示加载状态
        const labelEl = pageScreenshotBtn.querySelector(".label");
        const originalText = labelEl.textContent;
        labelEl.textContent = "截图中...";
        pageScreenshotBtn.style.pointerEvents = "none";
        pageScreenshotBtn.style.opacity = "0.6";

        showToast("正在进行整页截图，请勿操作页面...", "info");

        // Attach debugger
        await chrome.debugger.attach({ tabId: tab.id }, "1.3");

        try {
          // Enable page
          await chrome.debugger.sendCommand({ tabId: tab.id }, "Page.enable");

          // Get layout metrics
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

          // Capture screenshot
          const { data } = await chrome.debugger.sendCommand(
            { tabId: tab.id },
            "Page.captureScreenshot",
            {
              format: "png",
              captureBeyondViewport: true,
              clip: {
                x: 0,
                y: 0,
                width: width,
                height: height,
                scale: 1, // 高清：2
              },
            },
          );

          // Generate filename
          const hostname = new URL(url).hostname;
          const now = new Date();
          const dateStr = `${now.getFullYear()}${String(
            now.getMonth() + 1,
          ).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}_${String(
            now.getHours(),
          ).padStart(2, "0")}${String(now.getMinutes()).padStart(
            2,
            "0",
          )}${String(now.getSeconds()).padStart(2, "0")}`;
          const filename = `screenshot_${hostname}_${dateStr}.png`;

          // Trigger download
          const blob = await (
            await fetch(`data:image/png;base64,${data}`)
          ).blob();
          const downloadUrl = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.style.display = "none";
          a.href = downloadUrl;
          a.download = filename;
          document.body.appendChild(a);
          a.click();

          // Cleanup
          setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(downloadUrl);
          }, 100);

          showToast("截图已保存", "success");
        } finally {
          // Detach debugger
          await chrome.debugger.detach({ tabId: tab.id });

          // Reset button state
          labelEl.textContent = originalText;
          pageScreenshotBtn.style.pointerEvents = "auto";
          pageScreenshotBtn.style.opacity = "1";
        }
      } catch (error) {
        console.error("Screenshot failed:", error);
        showToast("截图失败: " + error.message, "error");

        // Reset button state
        const labelEl = pageScreenshotBtn.querySelector(".label");
        if (labelEl) labelEl.textContent = "页面截图";
        pageScreenshotBtn.style.pointerEvents = "auto";
        pageScreenshotBtn.style.opacity = "1";
      }
    });
  }

  // 选择截图
  let screenshotBusy = false;
  if (screenshotSelectBtn) {
    screenshotSelectBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      console.log("[豆豆] 点击了选择截图");
      try {
        const [tab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });

        const url = tab.url || "";
        if (
          url.startsWith("chrome://") ||
          url.startsWith("chrome-extension://") ||
          url.startsWith("edge://") ||
          url.startsWith("about:") ||
          url.startsWith("file://") ||
          !url.startsWith("http")
        ) {
          showToast("无法在此页面截图，请在普通网页上使用", "error");
          return;
        }

        if (screenshotBusy) return;
        screenshotBusy = true;

        console.log("[豆豆] 开始发送 POPUP_CAPTURE_SCREENSHOT 消息");
        // 通过 background 截取可视区域并发送给 content script 启动选区
        chrome.runtime.sendMessage(
          { type: "POPUP_CAPTURE_SCREENSHOT" },
          (res) => {
            screenshotBusy = false;
            console.log("[豆豆] 收到截图响应:", res);
            if (chrome.runtime.lastError) {
              console.error(
                "[豆豆] 截图失败:",
                chrome.runtime.lastError.message,
              );
              return;
            }
            if (res && !res.success) {
              console.error("[豆豆] 截图失败:", res.error);
              showToast("截图失败: " + res.error, "error");
            } else {
              // 成功后关闭 popup
              setTimeout(() => {
                window.close();
              }, 100);
            }
          },
        );
      } catch (error) {
        screenshotBusy = false;
        console.error("[豆豆] 截图过程出错:", error);
        showToast("截图失败: " + error.message, "error");
      }
    });
  }

  // 导出Cookies
  const exportCookiesBtn = document.getElementById("export-cookies");
  if (exportCookiesBtn) {
    exportCookiesBtn.addEventListener("click", async () => {
      try {
        // 获取当前标签页
        const [tab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });

        const url = tab.url || "";
        if (!url.startsWith("http")) {
          showToast("无法在此页面导出Cookies，请在普通网页上使用", "error");
          return;
        }

        // 显示加载状态
        const labelEl = exportCookiesBtn.querySelector(".label");
        const originalText = labelEl.textContent;
        labelEl.textContent = "导出中...";
        exportCookiesBtn.style.pointerEvents = "none";
        exportCookiesBtn.style.opacity = "0.6";

        // 读取导出格式设置
        const { otherConfig } = await chrome.storage.sync.get(["otherConfig"]);
        const format = otherConfig?.cookieExportFormat || "netscape";

        // 获取Cookies
        const result = await chrome.runtime.sendMessage({
          type: "GET_PAGE_COOKIES",
          url: url,
          format: format,
        });

        if (!result.success) {
          throw new Error(result.error || "获取Cookies失败");
        }

        if (result.count === 0) {
          showToast("当前页面没有Cookies", "info");
          labelEl.textContent = originalText;
          exportCookiesBtn.style.pointerEvents = "auto";
          exportCookiesBtn.style.opacity = "1";
          return;
        }

        // 根据格式确定文件扩展名和内容
        const isJson = format === "object";
        const fileExt = isJson ? "json" : "txt";
        const mimeType = isJson ? "application/json" : "text/plain";
        const cookieContent = isJson
          ? JSON.stringify(result.cookies, null, 2)
          : result.cookies;

        // 生成文件名：域名_日期_时间.ext
        const hostname = new URL(url).hostname;
        const now = new Date();
        const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(
          2,
          "0",
        )}${String(now.getDate()).padStart(2, "0")}_${String(
          now.getHours(),
        ).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(
          now.getSeconds(),
        ).padStart(2, "0")}`;
        const filename = `cookies_${hostname}_${date}.${fileExt}`;

        // 创建并下载文件
        const blob = new Blob([cookieContent], { type: mimeType });
        const downloadUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = downloadUrl;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(downloadUrl);

        showToast(`已导出 ${result.count} 个Cookies`, "success");

        // 恢复按钮状态
        labelEl.textContent = originalText;
        exportCookiesBtn.style.pointerEvents = "auto";
        exportCookiesBtn.style.opacity = "1";
      } catch (error) {
        showToast("导出失败: " + error.message, "error");
        // 恢复按钮状态
        const labelEl = exportCookiesBtn.querySelector(".label");
        if (labelEl) labelEl.textContent = "导出Cookies";
        exportCookiesBtn.style.pointerEvents = "auto";
        exportCookiesBtn.style.opacity = "1";
      }
    });
  }

  async function sendDouyinDownloadMessage(tabId) {
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(
        tabId,
        { action: "downloadDouyinMediaAction" },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          resolve(response);
        },
      );
    });
  }

  async function ensureDouyinDownloaderInjected(tabId) {
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ["src/douyin/downloader.css"],
    });
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["src/douyin/downloader.js"],
    });
  }

  // 抖音媒体统一下载
  const dyMediaBtn = document.getElementById("douyin-media-download");
  if (dyMediaBtn) {
    dyMediaBtn.addEventListener("click", async () => {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!tab?.id) return;

      const url = tab.url || "";
      if (!url.includes("douyin.com")) {
        showToast("请在抖音网页版使用此功能", "error");
        return;
      }

      dyMediaBtn.classList.add("loading");

      try {
        try {
          await sendDouyinDownloadMessage(tab.id);
        } catch {
          await ensureDouyinDownloaderInjected(tab.id);
          await sendDouyinDownloadMessage(tab.id);
        }
        window.close();
      } catch (error) {
        console.error("[豆豆] 抖音下载失败:", error.message);
        showToast(`抖音下载失败: ${error.message}`, "error");
      } finally {
        setTimeout(() => {
          dyMediaBtn.classList.remove("loading");
        }, 500);
      }
    });
  }

  // 生成二维码（在主页面中显示）
  const generateQrcodeBtn = document.getElementById("generate-qrcode");
  if (generateQrcodeBtn) {
    generateQrcodeBtn.addEventListener("click", async () => {
      try {
        const [tab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });

        const url = tab.url || "";
        if (!url.startsWith("http")) {
          showToast("无法为此页面生成二维码", "error");
          return;
        }

        // 通过 background.js 在主页面中生成二维码
        await chrome.runtime.sendMessage({
          type: "DOUDOU_BTN_ACTION",
          action: "generate-qrcode",
          tab: { id: tab.id, url: tab.url },
        });

        window.close();
      } catch (error) {
        showToast("生成二维码失败: " + error.message, "error");
      }
    });
  }

  // JSON编辑器
  const jsonEditorBtn = document.getElementById("json-editor");
  if (jsonEditorBtn) {
    jsonEditorBtn.addEventListener("click", () => {
      chrome.tabs.create({
        url: "src/jsoneditor/index.html",
      });
    });
  }

  // API 调试
  const apiDebuggerBtn = document.getElementById("api-debugger");
  if (apiDebuggerBtn) {
    apiDebuggerBtn.addEventListener("click", () => {
      chrome.tabs.create({
        url: "src/api_debugger/index.html",
      });
    });
  }

  // CPA / SUB 转换
  const cpaSubConverterBtn = document.getElementById("cpa-sub-converter");
  if (cpaSubConverterBtn) {
    cpaSubConverterBtn.addEventListener("click", () => {
      chrome.tabs.create({
        url: "src/cpa_sub_converter/index.html",
      });
    });
  }

  // CORS Unblock
  const corsUnblockBtn = document.getElementById("cors-unblock");
  const corsStatusEl = document.getElementById("cors-status");

  function renderCorsStatus(enabled) {
    if (!corsStatusEl) return;
    corsStatusEl.classList.toggle("active", !!enabled);
  }

  if (corsUnblockBtn) {
    chrome.runtime.sendMessage({ type: "GET_CORS_STATUS" }, (res) => {
      void chrome.runtime.lastError;
      renderCorsStatus(res?.config?.enabled ?? false);
    });

    corsUnblockBtn.addEventListener("click", async () => {
      try {
        const statusRes = await new Promise((resolve) => {
          chrome.runtime.sendMessage({ type: "GET_CORS_STATUS" }, (res) => {
            if (chrome.runtime.lastError) {
              console.error("[豆豆] GET_CORS_STATUS 错误:", chrome.runtime.lastError);
              resolve({ config: {} });
            } else {
              resolve(res);
            }
          });
        });

        const currentConfig = {
          ...DEFAULT_CORS_CONFIG,
          ...(statusRes?.config || {}),
        };
        const nextConfig = {
          ...currentConfig,
          enabled: !currentConfig.enabled,
        };

        await chrome.storage.local.set({ corsConfig: nextConfig });

        const updateRes = await new Promise((resolve) => {
          chrome.runtime.sendMessage({
            type: "CORS_UPDATE_CONFIG",
            config: nextConfig,
          }, (res) => {
            if (chrome.runtime.lastError) {
              console.error("[豆豆] CORS_UPDATE_CONFIG 错误:", chrome.runtime.lastError);
              resolve({ success: false, error: chrome.runtime.lastError.message });
            } else {
              resolve(res);
            }
          });
        });

        if (!updateRes?.success) {
          throw new Error(
            updateRes?.error ||
              `${nextConfig.enabled ? "开启" : "关闭"} CORS 状态失败`,
          );
        }

        renderCorsStatus(nextConfig.enabled);
      } catch (error) {
        showToast("切换 CORS 失败: " + error.message, "error");
      }
    });
  }

});

/**
 * 处理文章复刻
 */
async function handleCloneArticle() {
  try {
    // 检查是否配置了 OpenAI
    const { openaiConfig } = await chrome.storage.sync.get(["openaiConfig"]);
    if (!openaiConfig?.openaiApiKey) {
      showToast("请先在「设置」页面配置 OpenAI API Key", "error");
      return;
    }
    if (!openaiConfig?.openaiBaseUrl) {
      showToast("请先在「设置」页面配置 OpenAI Base URL", "error");
      return;
    }
    if (!openaiConfig?.openaiModel) {
      showToast("请先在「设置」页面配置 OpenAI 模型", "error");
      return;
    }

    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    const url = tab.url || "";
    if (
      url.startsWith("chrome://") ||
      url.startsWith("chrome-extension://") ||
      url.startsWith("edge://") ||
      url.startsWith("about:") ||
      url.startsWith("file://") ||
      !url.startsWith("http")
    ) {
      showToast("无法在此页面使用文章复刻，请在普通网页上使用", "error");
      return;
    }

    // Inject selector script
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: setCrawlerAutoConfirmTrue,
    });

    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      files: ["src/crawler-selector.js"],
    });

    // Mark that we are in replication mode
    await chrome.storage.local.set({ selector_mode: "article_replication" });

    showToast("请在页面上选择要复刻的内容区域");
    window.close();
  } catch (error) {
    showToast(error.message, "error");
  }
}
