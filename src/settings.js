/**
 * 设置页面脚本
 */

function escapeAttr(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

import { showToast } from "./utils/ui.js";
import {
  OpenAIClient,
  getTranslateConfig,
  setTranslateConfig,
} from "./ai/openai.js";

// DOM 元素引用
let elements = {};

/**
 * 加载保存的设置
 */
async function loadSettings() {
  try {
    const otherResult = await chrome.storage.sync.get(["otherConfig"]);
    const otherConfig = otherResult.otherConfig || {};
    if (elements.cookieExportFormat) {
      elements.cookieExportFormat.value =
        otherConfig.cookieExportFormat || "netscape";
    }
  } catch (error) {
    console.error("加载设置失败:", error);
  }
}

/**
 * 保存其他设置
 */
async function saveOtherSettings() {
  const otherConfig = {
    cookieExportFormat: elements.cookieExportFormat?.value || "netscape",
  };

  try {
    await chrome.storage.sync.set({ otherConfig });
    showToast("✓ 设置已保存", "success");
  } catch (error) {
    console.error("保存其他设置失败:", error);
    showToast("保存设置失败", "error");
  }
}

/**
 * 切换 Tab
 */
function switchTab(tabId) {
  // 更新 URL hash
  history.replaceState(null, "", `#${tabId}`);

  // 更新导航选中状态
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.tab === tabId);
  });

  // 更新面板显示
  document.querySelectorAll(".panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === `${tabId}-panel`);
  });

  // 如果切换到 CORS，刷新状态
  if (tabId === "cors") {
    loadCorsSettings();
  }
}

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

let currentCorsConfig = { ...DEFAULT_CORS_CONFIG };

const CORS_CONFIG_MAP = {
  enabled: "cors-enabled",
  allowOrigin: "cors-allow-origin",
  allowMethods: "cors-allow-methods",
  allowHeaders: "cors-allow-headers",
  allowCredentials: "cors-allow-credentials",
  exposeHeaders: "cors-expose-headers",
  noOverwrite: "cors-no-overwrite",
  removeCSP: "cors-remove-csp",
  removeXFrame: "cors-remove-xframe",
  sharedArrayBuffer: "cors-shared-array-buffer",
  removeRefererOrigin: "cors-remove-referer-origin",
  fixRedirect: "cors-fix-redirect",
};

const CORS_UNSUPPORTED_KEYS = new Set([
  "allowCredentials",
  "noOverwrite",
  "fixRedirect",
]);

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

function collectCorsEffectiveUrlsFromUI() {
  const inputs = document.querySelectorAll(".cors-url-input");
  const urls = [];
  const seen = new Set();

  for (const input of inputs) {
    const raw = input.value.trim();
    if (!raw) continue;

    let url;
    try {
      url = new URL(raw);
      // 完整 URL 模式：必须是 http/https
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error("生效链接仅支持 http 或 https");
      }
      const normalizedUrl = raw.split("#")[0];
      if (!seen.has(normalizedUrl)) {
        seen.add(normalizedUrl);
        urls.push(normalizedUrl);
      }
    } catch (urlError) {
      // 域名模式：直接保存，不需要验证协议
      if (!seen.has(raw)) {
        seen.add(raw);
        urls.push(raw);
      }
    }
  }

  return urls.length > 0 ? urls : [...DEFAULT_CORS_EFFECTIVE_URLS];
}

function addCorsEffectiveUrl(value = "", shouldFocus = true) {
  const list = document.getElementById("cors-effective-url-list");
  if (!list) return;

  const item = document.createElement("div");
  item.className = "cors-url-item";
  item.innerHTML = `
    <input type="text" class="cors-url-input" value="${escapeAttr(value)}" placeholder="域名或完整URL（如：undsky.com 或 https://example.com/path）" />
    <button class="btn btn-danger" type="button">删除</button>
  `;

  const input = item.querySelector(".cors-url-input");
  input.addEventListener("change", saveCorsSettings);

  item.querySelector(".btn-danger").addEventListener("click", async () => {
    item.remove();
    if (!list.querySelector(".cors-url-item")) {
      addCorsEffectiveUrl(DEFAULT_CORS_EFFECTIVE_URLS[0], false);
    }
    await saveCorsSettings();
  });

  list.appendChild(item);
  if (shouldFocus) input.focus();
}

function renderCorsEffectiveUrls(urls) {
  const list = document.getElementById("cors-effective-url-list");
  if (!list) return;

  list.innerHTML = "";
  normalizeCorsEffectiveUrls(urls).forEach((url) =>
    addCorsEffectiveUrl(url, false),
  );
}

function normalizeImportedCorsConfig(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("文件格式错误：需要 JSON 对象");
  }

  const nextConfig = { ...DEFAULT_CORS_CONFIG };
  for (const key of Object.keys(DEFAULT_CORS_CONFIG)) {
    if (key === "effectiveUrls") continue;
    if (typeof config[key] === "boolean") {
      nextConfig[key] = config[key];
    }
  }
  nextConfig.effectiveUrls = normalizeCorsEffectiveUrls(config.effectiveUrls);
  return nextConfig;
}

async function exportCorsConfig() {
  try {
    const config = {
      ...currentCorsConfig,
      effectiveUrls: collectCorsEffectiveUrlsFromUI(),
    };
    for (const [key, id] of Object.entries(CORS_CONFIG_MAP)) {
      const el = document.getElementById(id);
      if (!el) continue;
      config[key] = CORS_UNSUPPORTED_KEYS.has(key) ? false : el.checked;
    }

    const blob = new Blob([JSON.stringify(config, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cors_config_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("✓ CORS 配置已导出", "success");
  } catch (error) {
    console.error("导出 CORS 配置失败:", error);
    showToast(error.message || "导出失败", "error");
  }
}

async function importCorsConfig(file) {
  try {
    const text = await file.text();
    const imported = normalizeImportedCorsConfig(JSON.parse(text));
    applyCorsConfigToUI(imported);
    await saveCorsSettings(true);
  } catch (error) {
    console.error("导入 CORS 配置失败:", error);
    showToast(error.message || "导入失败：文件格式不正确", "error");
  }
}

function applyCorsConfigToUI(config) {
  currentCorsConfig = {
    ...DEFAULT_CORS_CONFIG,
    ...config,
    effectiveUrls: normalizeCorsEffectiveUrls(config.effectiveUrls),
  };

  for (const [key, id] of Object.entries(CORS_CONFIG_MAP)) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.checked = !!currentCorsConfig[key];
    if (CORS_UNSUPPORTED_KEYS.has(key)) {
      el.disabled = true;
    }
  }

  renderCorsEffectiveUrls(currentCorsConfig.effectiveUrls);
}

async function loadCorsSettings() {
  try {
    const response = await chrome.runtime.sendMessage({
      type: "GET_CORS_STATUS",
    });
    const config = {
      ...DEFAULT_CORS_CONFIG,
      ...(response?.config || {}),
      ...(response?.effectiveConfig || {}),
    };
    applyCorsConfigToUI(config);
  } catch (error) {
    console.error("加载 CORS 配置失败:", error);
  }
}

async function saveCorsSettings(showSuccess = false) {
  try {
    const config = {
      ...currentCorsConfig,
      effectiveUrls: collectCorsEffectiveUrlsFromUI(),
    };

    for (const [key, id] of Object.entries(CORS_CONFIG_MAP)) {
      const el = document.getElementById(id);
      if (!el) continue;
      config[key] = CORS_UNSUPPORTED_KEYS.has(key) ? false : el.checked;
    }

    const response = await chrome.runtime.sendMessage({
      type: "CORS_UPDATE_CONFIG",
      config,
    });

    if (!response?.success) {
      throw new Error(response?.error || "保存 CORS 配置失败");
    }

    const nextConfig = {
      ...DEFAULT_CORS_CONFIG,
      ...config,
      ...(response?.effectiveConfig || {}),
    };

    await chrome.storage.local.set({ corsConfig: nextConfig });
    applyCorsConfigToUI(nextConfig);
    if (showSuccess) showToast("✓ 设置已保存", "success");
    return nextConfig;
  } catch (error) {
    console.error("保存 CORS 配置失败:", error);
    showToast(error.message || "保存失败", "error");
    throw error;
  }
}

function initCorsEventListeners() {
  for (const [key, id] of Object.entries(CORS_CONFIG_MAP)) {
    const el = document.getElementById(id);
    if (!el || CORS_UNSUPPORTED_KEYS.has(key)) continue;
    el.addEventListener("change", saveCorsSettings);
  }

  document
    .getElementById("add-cors-effective-url")
    ?.addEventListener("click", () => {
      addCorsEffectiveUrl();
      // 不立即保存，等用户输入后再保存
    });

  document
    .getElementById("export-cors-config")
    ?.addEventListener("click", exportCorsConfig);

  const importCorsConfigFile = document.getElementById("import-cors-config-file");
  document
    .getElementById("import-cors-config")
    ?.addEventListener("click", () => importCorsConfigFile?.click());
  importCorsConfigFile?.addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (file) {
      importCorsConfig(file);
      importCorsConfigFile.value = "";
    }
  });
}

// ==================== 翻译配置 ====================

let currentTranslateModelsTaskId = 0;

/**
 * 读取翻译配置并填充表单
 */
async function loadTranslateConfig() {
  try {
    const config = await getTranslateConfig();
    const baseUrlEl = document.getElementById("translateBaseUrl");
    const apiKeyEl = document.getElementById("translateApiKey");
    const modelEl = document.getElementById("translateModel");
    if (baseUrlEl) baseUrlEl.value = config.baseUrl || "";
    if (apiKeyEl) apiKeyEl.value = config.apiKey || "";
    if (modelEl) modelEl.value = config.model || "";
  } catch (error) {
    console.error("加载翻译配置失败:", error);
  }
}

/**
 * 保存翻译配置（自动保存）
 */
async function saveTranslateConfig(showSuccess = false) {
  try {
    await setTranslateConfig({
      baseUrl: document.getElementById("translateBaseUrl")?.value.trim() || "",
      apiKey: document.getElementById("translateApiKey")?.value.trim() || "",
      model: document.getElementById("translateModel")?.value.trim() || "",
    });
    if (showSuccess) showToast("✓ 设置已保存", "success");
  } catch (error) {
    console.error("保存翻译配置失败:", error);
    showToast("保存失败", "error");
  }
}

/**
 * 测试翻译模型连接
 */
async function testTranslateConfig() {
  const apiKey = document.getElementById("translateApiKey").value.trim();
  const baseUrl = document.getElementById("translateBaseUrl").value.trim();
  const model = document.getElementById("translateModel").value.trim();

  if (!apiKey) {
    showToast("请先填写 API Key", "error");
    return;
  }
  if (!baseUrl) {
    showToast("请先填写 API Base URL", "error");
    return;
  }
  if (!model) {
    showToast("请先填写模型名称", "error");
    return;
  }

  const testBtn = document.getElementById("translateTestBtn");
  const originalText = testBtn.textContent;
  testBtn.textContent = "测试中...";
  testBtn.disabled = true;

  try {
    const client = new OpenAIClient({
      apiKey,
      baseURL: baseUrl,
      model,
      maxRetries: 0,
      timeout: 15000,
    });

    const reply = await client.chat("你是什么模型", { max_tokens: 5 });
    showToast(`✓ 连接成功！模型回复: ${reply}`, "success");
  } catch (error) {
    showToast(`✗ 连接失败: ${error.message}`, "error");
  } finally {
    testBtn.textContent = originalText;
    testBtn.disabled = false;
  }
}

/**
 * 获取翻译模型列表
 */
async function getTranslateModels() {
  const apiKey = document.getElementById("translateApiKey").value.trim();
  const baseUrl = document.getElementById("translateBaseUrl").value.trim();

  if (!baseUrl) {
    showToast("请先填写 API Base URL", "error");
    return;
  }

  const getModelsBtn = document.getElementById("translateGetModelsBtn");
  const statusEl = document.getElementById("translateGetModelsStatus");
  const modelsListEl = document.getElementById("translateModelsList");

  if (!getModelsBtn || !statusEl || !modelsListEl) return;

  // 递增任务 ID，生成当前调用的唯一标志
  currentTranslateModelsTaskId++;
  const taskId = currentTranslateModelsTaskId;

  const originalText = getModelsBtn.textContent;
  getModelsBtn.textContent = "获取中...";
  getModelsBtn.disabled = true;
  statusEl.textContent = "";
  modelsListEl.style.display = "none";
  modelsListEl.innerHTML = "";

  try {
    const headers = {
      "Content-Type": "application/json",
    };
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    const cleanedBaseUrl = baseUrl.replace(/\/+$/, "");
    const response = await fetch(`${cleanedBaseUrl}/models`, {
      method: "GET",
      headers: headers,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`HTTP ${response.status}: ${errText}`);
    }

    const result = await response.json();
    const models = result.data || [];
    if (!Array.isArray(models) || models.length === 0) {
      statusEl.textContent = "未获取到有效的模型列表";
      return;
    }

    // 显示筛选框
    const filterEl = document.getElementById("translateModelsFilter");
    if (filterEl) {
      filterEl.style.display = "block";
    }

    modelsListEl.style.display = "grid";

    models.forEach((m) => {
      const modelId = m.id;
      if (!modelId) return;

      const container = document.createElement("div");
      container.className = "model-item";
      container.dataset.modelId = modelId.toLowerCase();
      container.style.cssText =
        "display: flex; align-items: center; justify-content: space-between; border: 1px solid #d9d9d9; border-radius: 4px; background: #f5f5f5; transition: all 0.2s; overflow: hidden;";

      const badge = document.createElement("span");
      badge.className = "model-badge";
      badge.textContent = modelId;
      badge.dataset.status = "pending"; // 初始 pending 状态
      badge.style.cssText =
        "cursor: pointer; display: inline-block; padding: 4px 8px; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: calc(100% - 50px); flex: 1;";

      const testBtn = document.createElement("button");
      testBtn.className = "btn";
      testBtn.textContent = "测活";
      testBtn.style.cssText =
        "font-size: 12px; padding: 2px 6px; margin-right: 4px; border-radius: 4px; border: 1px solid #d9d9d9; background: #fff; cursor: pointer;";

      container.addEventListener("mouseenter", () => {
        container.style.background = "#e6f7ff";
        container.style.borderColor = "#91d5ff";
        badge.style.color = "#1890ff";
      });
      container.addEventListener("mouseleave", () => {
        if (badge.dataset.status === "success") {
          container.style.background = "#f6ffed";
          container.style.borderColor = "#b7eb8f";
          badge.style.color = "#389e0d";
        } else if (badge.dataset.status === "error") {
          container.style.background = "#fff1f0";
          container.style.borderColor = "#ffccc7";
          badge.style.color = "#cf1322";
        } else if (badge.dataset.status === "testing") {
          container.style.background = "#fffbe6";
          container.style.borderColor = "#ffe58f";
          badge.style.color = "";
        } else {
          container.style.background = "#f5f5f5";
          container.style.borderColor = "#d9d9d9";
          badge.style.color = "";
        }
      });

      badge.addEventListener("click", () => {
        const modelInput = document.getElementById("translateModel");
        if (modelInput) {
          modelInput.value = modelId;
          saveTranslateConfig(false);
          showToast(`已选择模型: ${modelId}`, "success");
        }
      });

      testBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        testBtn.textContent = "测活中...";
        testBtn.disabled = true;

        badge.dataset.status = "testing";
        container.style.background = "#fffbe6";
        container.style.borderColor = "#ffe58f";
        badge.style.color = "";

        try {
          const client = new OpenAIClient({
            apiKey,
            baseURL: baseUrl,
            model: modelId,
            maxRetries: 0,
            timeout: 10000,
          });

          await client.chat("Hi", { max_tokens: 5 });

          badge.dataset.status = "success";
          container.style.background = "#f6ffed";
          container.style.borderColor = "#b7eb8f";
          badge.style.color = "#389e0d";
          testBtn.textContent = "测活";
        } catch (error) {
          badge.dataset.status = "error";
          container.style.background = "#fff1f0";
          container.style.borderColor = "#ffccc7";
          badge.style.color = "#cf1322";
          container.title = `测活失败: ${error.message}`;
          testBtn.textContent = "测活";
          showToast(`测活失败: ${error.message}`, "error");
        } finally {
          testBtn.disabled = false;
        }
      });

      container.appendChild(badge);
      container.appendChild(testBtn);
      modelsListEl.appendChild(container);
    });

    if (currentTranslateModelsTaskId === taskId) {
      statusEl.textContent = `共获取 ${models.length} 个模型`;
    }

    // 绑定筛选功能
    if (filterEl) {
      // 移除之前的事件监听器（如果存在）
      const newFilterEl = filterEl.cloneNode(true);
      filterEl.parentNode.replaceChild(newFilterEl, filterEl);

      newFilterEl.addEventListener("input", (e) => {
        const keyword = e.target.value.toLowerCase().trim();
        const items = modelsListEl.querySelectorAll(".model-item");
        let visibleCount = 0;

        items.forEach((item) => {
          const modelId = item.dataset.modelId;
          if (!keyword || modelId.includes(keyword)) {
            item.style.display = "flex";
            visibleCount++;
          } else {
            item.style.display = "none";
          }
        });

        if (currentTranslateModelsTaskId === taskId) {
          statusEl.textContent = keyword
            ? `筛选模型 ${visibleCount} 个`
            : `共获取 ${models.length} 个模型`;
        }
      });
    }
  } catch (error) {
    // 再次检查任务状态，防覆盖
    if (currentTranslateModelsTaskId === taskId) {
      statusEl.textContent = `获取失败: ${error.message}`;
      showToast(`获取模型失败: ${error.message}`, "error");
    }
  } finally {
    if (currentTranslateModelsTaskId === taskId) {
      getModelsBtn.textContent = originalText;
      getModelsBtn.disabled = false;
    }
  }
}

/**
 * 初始化
 */
function init() {
  // 获取 DOM 元素
  elements = {
    toast: document.getElementById("toast"),
    cookieExportFormat: document.getElementById("cookieExportFormat"),
  };

  // 自动保存 - 其他设置
  ["cookieExportFormat"].forEach((key) => {
    if (elements[key])
      elements[key].addEventListener("change", saveOtherSettings);
  });

  // 自动保存 - CORS 配置
  initCorsEventListeners();

  // 翻译配置：自动保存
  ["translateBaseUrl", "translateApiKey", "translateModel"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("change", () => saveTranslateConfig(false));
  });

  const translateTestBtn = document.getElementById("translateTestBtn");
  if (translateTestBtn)
    translateTestBtn.addEventListener("click", testTranslateConfig);

  const translateGetModelsBtn = document.getElementById(
    "translateGetModelsBtn",
  );
  if (translateGetModelsBtn)
    translateGetModelsBtn.addEventListener("click", getTranslateModels);

  // Tab 切换事件
  document.querySelectorAll(".nav-item[data-tab]").forEach((item) => {
    item.addEventListener("click", () => switchTab(item.dataset.tab));
  });

  // 逆向面板内部 Tab 切换
  document.querySelectorAll(".reverse-nav-item").forEach((item) => {
    item.addEventListener("click", () => {
      const tabId = item.dataset.reverseTab;
      // 更新导航选中状态
      document.querySelectorAll(".reverse-nav-item").forEach((nav) => {
        nav.classList.toggle("active", nav.dataset.reverseTab === tabId);
      });
      // 更新内容显示
      document.querySelectorAll(".reverse-tab-content").forEach((content) => {
        content.classList.toggle("active", content.id === `reverse-${tabId}`);
      });
    });
  });



  // 加载设置
  loadSettings();
  loadTranslateConfig();
  loadCorsSettings();

  // 显示版本号
  const versionEl = document.getElementById("app-version");
  if (versionEl) {
    const manifest = chrome.runtime.getManifest();
    versionEl.textContent = `版本 v${manifest.version}`;
  }


  // 检查 URL hash，根据 hash 切换到对应 tab
  const hash = window.location.hash.slice(1);
  if (hash && document.getElementById(`${hash}-panel`)) {
    switchTab(hash);
  }
}

// 页面加载完成后初始化
document.addEventListener("DOMContentLoaded", init);
