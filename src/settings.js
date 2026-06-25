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

import { showToast, showConfirm } from "./utils/ui.js";
import { OpenAIClient } from "./ai/openai.js";

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

  // 如果切换到爬虫规则，加载列表
  if (tabId === "crawlers") {
    loadCrawlerList();
  }
  // 如果切换到 CORS，刷新状态
  if (tabId === "cors") {
    loadCorsSettings();
  }
  // 如果切换到 AI 配置，加载列表
  if (tabId === "openai") {
    loadOpenaiList();
  }
}

/**
 * 加载爬虫配置列表
 */
async function loadCrawlerList() {
  const listContainer = document.getElementById("crawler-list");
  listContainer.innerHTML =
    '<div style="color:#999;text-align:center;padding:20px;">加载中...</div>';

  try {
    const { crawler_configs = [] } =
      await chrome.storage.local.get("crawler_configs");

    if (crawler_configs.length === 0) {
      listContainer.innerHTML =
        '<div style="color:#999;text-align:center;padding:20px;">暂无已保存的爬虫规则</div>';
      return;
    }

    listContainer.innerHTML = "";
    [...crawler_configs].reverse().forEach((config) => {
      const item = document.createElement("div");
      item.className = "crawler-item";

      const crawlMode = config.crawlMode || { mode: "static" };
      const configId = config.id;

      item.innerHTML = `
        <div class="crawler-header" style="display: flex; justify-content: space-between; align-items: flex-start; width: 100%;">
          <div class="crawler-info" style="flex: 1;">
            <div class="form-group" style="margin-bottom: 8px;">
              <input type="text" class="crawler-url-input" data-id="${configId}" value="${escapeAttr(config.urlPattern)}" placeholder="爬取链接" style="font-size: 16px; font-weight: 500;" />
            </div>
          </div>
          <div class="crawler-actions" style="display: flex; gap: 8px;">
            <button class="btn btn-save" data-id="${configId}">保存</button>
            <button class="btn btn-danger" data-id="${configId}">删除</button>
          </div>
        </div>
        <input type="text" class="crawler-selector-input" data-id="${configId}" value="${escapeAttr(config.selector)}" placeholder="爬取选择器" style="font-size: 16px; font-weight: 500;" />
        <input type="text" class="crawler-selector-input crawler-link-selector-input" data-id="${configId}" value="${escapeAttr(config.linkSelector)}" placeholder="链接选择器" style="font-size: 16px; font-weight: 500;" />
        <input type="text" class="crawler-selector-input crawler-date-selector-input" data-id="${configId}" value="${escapeAttr(config.dateSelector)}" placeholder="日期选择器" style="font-size: 16px; font-weight: 500;" />
        <input type="text" class="crawler-selector-input crawler-content-selector-input" data-id="${configId}" value="${escapeAttr(config.contentSelector)}" placeholder="内容选择器" style="font-size: 16px; font-weight: 500;" />
        <div class="crawl-mode-edit">
          <span class="mode-label">爬取模式：</span>
          <label><input type="radio" name="crawl-mode-${configId}" value="static" ${crawlMode.mode === "static" ? "checked" : ""}> 仅爬取</label>
          <label><input type="radio" name="crawl-mode-${configId}" value="scroll" ${crawlMode.mode === "scroll" ? "checked" : ""}> 滚动</label>
          <label><input type="radio" name="crawl-mode-${configId}" value="pagination" ${crawlMode.mode === "pagination" ? "checked" : ""}> 分页</label>
          <div class="crawl-mode-panel scroll-options" data-id="${configId}" style="display:${crawlMode.mode === "scroll" ? "flex" : "none"}">
            <span class="mode-label">滚动次数</span>
            <input type="number" class="scroll-count" value="${crawlMode.scrollCount || 5}" min="1" max="100">
            <span class="mode-unit">次</span>
            <span class="mode-label">滚动距离</span>
            <input type="number" class="scroll-distance" value="${crawlMode.scrollDistance || 800}" min="100" max="10000" step="100">
            <span class="mode-unit">px</span>
          </div>
          <div class="crawl-mode-panel pagination-options" data-id="${configId}" style="display:${crawlMode.mode === "pagination" ? "flex" : "none"}">
            <input type="text" class="pagination-selector" value="${escapeAttr(crawlMode.paginationSelector)}" placeholder="分页选择器">
            <span class="mode-label">分页次数</span>
            <input type="number" class="pagination-count" value="${crawlMode.paginationCount || 5}" min="1" max="100">
            <span class="mode-unit">页</span>
          </div>
        </div>
      `;

      // 抓取模式切换显示/隐藏
      const radios = item.querySelectorAll(
        `input[name="crawl-mode-${configId}"]`,
      );
      const scrollOpts = item.querySelector(
        `.scroll-options[data-id="${configId}"]`,
      );
      const paginationOpts = item.querySelector(
        `.pagination-options[data-id="${configId}"]`,
      );
      radios.forEach((radio) => {
        radio.addEventListener("change", () => {
          scrollOpts.style.display = radio.value === "scroll" ? "flex" : "none";
          paginationOpts.style.display =
            radio.value === "pagination" ? "flex" : "none";
        });
      });

      // 提取保存方法
      const saveItem = (silent = false) => {
        const newUrlPattern = item
          .querySelector(".crawler-url-input")
          .value.trim();
        const newSelector = item
          .querySelector(".crawler-selector-input")
          .value.trim();
        const newLinkSelector = item
          .querySelector(".crawler-link-selector-input")
          .value.trim();
        const newDateSelector = item
          .querySelector(".crawler-date-selector-input")
          .value.trim();
        const newContentSelector = item
          .querySelector(".crawler-content-selector-input")
          .value.trim();
        if (!newUrlPattern) {
          if (!silent) showToast("URL 匹配模式不能为空", "error");
          // 允许存为草稿，不阻断
        }
        // 收集抓取模式设置
        const selectedMode = item.querySelector(
          `input[name="crawl-mode-${configId}"]:checked`,
        ).value;
        const newCrawlMode = { mode: selectedMode };
        if (selectedMode === "scroll") {
          newCrawlMode.scrollCount =
            parseInt(item.querySelector(".scroll-count").value) || 5;
          newCrawlMode.scrollDistance =
            parseInt(item.querySelector(".scroll-distance").value) || 800;
        } else if (selectedMode === "pagination") {
          const pagSelector = item
            .querySelector(".pagination-selector")
            .value.trim();
          if (!pagSelector) {
            if (!silent) showToast("分页元素选择器不能为空", "error");
            // 允许存为草稿，不阻断
          }
          newCrawlMode.paginationSelector = pagSelector;
          newCrawlMode.paginationCount =
            parseInt(item.querySelector(".pagination-count").value) || 5;
        }
        updateCrawlerConfig(
          configId,
          newUrlPattern,
          newSelector,
          newCrawlMode,
          newDateSelector,
          newContentSelector,
          newLinkSelector,
          silent,
        );
      };

      // 绑定保存事件 (点击按钮弹 toast)
      item
        .querySelector(".btn-save")
        .addEventListener("click", () => saveItem(false));

      // 自动保存：输入框 change 事件（失去焦点会触发）
      item.querySelectorAll("input").forEach((input) => {
        input.addEventListener("change", () => saveItem(true));
      });

      // 绑定删除事件
      item.querySelector(".btn-danger").addEventListener("click", async () => {
        if (await showConfirm("确定要删除这个采集规则吗？")) {
          deleteCrawlerConfig(configId);
        }
      });

      listContainer.appendChild(item);
    });
  } catch (error) {
    console.error("加载爬虫列表失败:", error);
    listContainer.innerHTML =
      '<div style="color:red;text-align:center;padding:20px;">加载失败</div>';
  }
}

/**
 * 删除爬虫配置
 */
async function deleteCrawlerConfig(id) {
  try {
    const { crawler_configs = [] } =
      await chrome.storage.local.get("crawler_configs");
    // 确保 ID 类型一致再比较
    const targetId = String(id);
    const newConfigs = crawler_configs.filter((c) => String(c.id) !== targetId);

    // 如果数量没变，说明删除失败（找不到ID）
    if (newConfigs.length === crawler_configs.length) {
      console.warn("未找到要删除的规则 ID:", id);
    }

    await chrome.storage.local.set({ crawler_configs: newConfigs });

    showToast("删除成功", "success");
    loadCrawlerList(); // 重新加载列表
  } catch (error) {
    console.error("删除失败:", error);
    showToast("删除失败", "error");
  }
}

/**
 * 更新爬虫配置（选择器 + 抓取模式）
 */
async function updateCrawlerConfig(
  id,
  newUrlPattern,
  newSelector,
  newCrawlMode,
  newDateSelector,
  newContentSelector,
  newLinkSelector,
  silent = false,
) {
  try {
    const { crawler_configs = [] } =
      await chrome.storage.local.get("crawler_configs");
    const index = crawler_configs.findIndex((c) => c.id === id);
    if (index !== -1) {
      crawler_configs[index].urlPattern = newUrlPattern;
      crawler_configs[index].selector = newSelector;
      crawler_configs[index].linkSelector = newLinkSelector || "";
      crawler_configs[index].dateSelector = newDateSelector || "";
      crawler_configs[index].contentSelector = newContentSelector || "";
      crawler_configs[index].crawlMode = newCrawlMode;
      await chrome.storage.local.set({ crawler_configs });
      if (!silent) {
        showToast("规则已更新", "success");
      }
    }
  } catch (error) {
    console.error("更新失败:", error);
    if (!silent) {
      showToast("更新失败", "error");
    }
  }
}

/**
 * 添加新爬虫配置
 */
async function addCrawlerConfig(
  urlPattern,
  selector,
  crawlMode,
  dateSelector,
  contentSelector,
  linkSelector,
) {
  try {
    const { crawler_configs = [] } =
      await chrome.storage.local.get("crawler_configs");

    const newConfig = {
      id: Date.now().toString(),
      urlPattern,
      selector,
      linkSelector: linkSelector || "",
      dateSelector: dateSelector || "",
      contentSelector: contentSelector || "",
      crawlMode: crawlMode || { mode: "static" },
    };

    crawler_configs.push(newConfig);
    await chrome.storage.local.set({ crawler_configs });
    showToast("规则已添加", "success");
    loadCrawlerList();
  } catch (error) {
    console.error("添加失败:", error);
    showToast("添加失败", "error");
  }
}

/**
 * 导出爬虫规则为 JSON 文件
 */
async function exportCrawlerConfigs() {
  try {
    const { crawler_configs = [] } =
      await chrome.storage.local.get("crawler_configs");
    if (crawler_configs.length === 0) {
      showToast("暂无规则可导出", "error");
      return;
    }
    const blob = new Blob([JSON.stringify(crawler_configs, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `crawler_rules_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("✓ 规则已导出", "success");
  } catch (error) {
    console.error("导出失败:", error);
    showToast("导出失败", "error");
  }
}

/**
 * 导入爬虫规则（从 JSON 文件）
 */
async function importCrawlerConfigs(file) {
  try {
    const text = await file.text();
    const imported = JSON.parse(text);
    if (!Array.isArray(imported)) {
      showToast("文件格式错误：需要 JSON 数组", "error");
      return;
    }
    const { crawler_configs = [] } =
      await chrome.storage.local.get("crawler_configs");
    const existingUrls = new Set(crawler_configs.map((c) => c.urlPattern));
    let addedCount = 0;
    for (const item of imported) {
      if (!item.urlPattern) continue;
      if (existingUrls.has(item.urlPattern)) continue;
      crawler_configs.push({
        id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
        urlPattern: item.urlPattern,
        selector: item.selector,
        linkSelector: item.linkSelector || "",
        dateSelector: item.dateSelector || "",
        contentSelector: item.contentSelector || "",
        crawlMode: item.crawlMode || { mode: "static" },
      });
      existingUrls.add(item.urlPattern);
      addedCount++;
    }
    await chrome.storage.local.set({ crawler_configs });
    showToast(`✓ 已导入 ${addedCount} 条规则`, "success");
    loadCrawlerList();
  } catch (error) {
    console.error("导入失败:", error);
    showToast("导入失败：文件格式不正确", "error");
  }
}

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
    } catch {
      continue;
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") continue;
    const normalizedUrl = raw.split("#")[0];
    if (!seen.has(normalizedUrl)) {
      seen.add(normalizedUrl);
      normalized.push(normalizedUrl);
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
    } catch {
      throw new Error("生效链接格式不正确");
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("生效链接仅支持 http 或 https");
    }

    const normalizedUrl = raw.split("#")[0];
    if (!seen.has(normalizedUrl)) {
      seen.add(normalizedUrl);
      urls.push(normalizedUrl);
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
    <input type="url" class="cors-url-input" value="${escapeAttr(value)}" />
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
    ?.addEventListener("click", () => addCorsEffectiveUrl());

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

// ==================== AI 配置（多配置 + 侧边栏布局） ====================

const DEFAULT_OPENAI_CONFIG = {
  openaiApiKey: "",
  openaiBaseUrl: "",
  openaiModel: "",
  type: "dialog", // translate 或 dialog，默认为对话
};

let openaiConfigs = [];
let currentOpenaiId = null;
let openaiDragItem = null;
let currentGetModelsTaskId = 0;

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function normalizeOpenaiConfig(config = {}, usedIds = null) {
  let id = generateId();
  if (usedIds) {
    while (usedIds.has(id)) {
      id = generateId();
    }
    usedIds.add(id);
  }

  return {
    id,
    name: typeof config.name === "string" ? config.name : "",
    openaiApiKey:
      typeof config.openaiApiKey === "string"
        ? config.openaiApiKey
        : DEFAULT_OPENAI_CONFIG.openaiApiKey,
    openaiBaseUrl:
      typeof config.openaiBaseUrl === "string"
        ? config.openaiBaseUrl
        : DEFAULT_OPENAI_CONFIG.openaiBaseUrl,
    openaiModel:
      typeof config.openaiModel === "string"
        ? config.openaiModel
        : DEFAULT_OPENAI_CONFIG.openaiModel,
    type:
      config.type === "translate" || config.type === "dialog"
        ? config.type
        : DEFAULT_OPENAI_CONFIG.type,
  };
}

function createOpenaiConfig(config = {}, usedIds = null) {
  let id = typeof config.id === "string" ? config.id.trim() : "";
  if (!id) id = generateId();
  if (usedIds) {
    while (usedIds.has(id)) {
      id = generateId();
    }
    usedIds.add(id);
  }

  return {
    id,
    name: typeof config.name === "string" ? config.name : "",
    openaiApiKey:
      typeof config.openaiApiKey === "string"
        ? config.openaiApiKey
        : DEFAULT_OPENAI_CONFIG.openaiApiKey,
    openaiBaseUrl:
      typeof config.openaiBaseUrl === "string"
        ? config.openaiBaseUrl
        : DEFAULT_OPENAI_CONFIG.openaiBaseUrl,
    openaiModel:
      typeof config.openaiModel === "string"
        ? config.openaiModel
        : DEFAULT_OPENAI_CONFIG.openaiModel,
    type:
      config.type === "translate" || config.type === "dialog"
        ? config.type
        : DEFAULT_OPENAI_CONFIG.type,
  };
}

function normalizeOpenaiConfigs(configs = []) {
  const usedIds = new Set();
  let changed = false;

  const normalizedConfigs = configs.map((config) => {
    const normalized = createOpenaiConfig(config, usedIds);
    if (
      !config ||
      normalized.id !== config.id ||
      normalized.name !== config.name ||
      normalized.openaiApiKey !== config.openaiApiKey ||
      normalized.openaiBaseUrl !== config.openaiBaseUrl ||
      normalized.openaiModel !== config.openaiModel ||
      normalized.type !== config.type
    ) {
      changed = true;
    }
    return normalized;
  });

  return { normalizedConfigs, changed };
}

function getOpenaiConfigFingerprint(config = {}) {
  return JSON.stringify({
    name: (config.name || "").trim(),
    openaiApiKey: config.openaiApiKey || "",
    openaiBaseUrl: config.openaiBaseUrl || "",
    openaiModel: config.openaiModel || "",
  });
}

async function exportOpenaiConfigs() {
  try {
    if (openaiConfigs.length === 0) {
      showToast("暂无配置可导出", "error");
      return;
    }

    const exportConfigs = openaiConfigs.map(({ id, ...config }) => config);
    const blob = new Blob([JSON.stringify(exportConfigs, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ai_configs_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("✓ 配置已导出", "success");
  } catch (error) {
    console.error("导出 AI 配置失败:", error);
    showToast("导出失败", "error");
  }
}

async function importOpenaiConfigs(file) {
  try {
    const text = await file.text();
    const imported = JSON.parse(text);
    if (!Array.isArray(imported)) {
      showToast("文件格式错误：需要 JSON 数组", "error");
      return;
    }

    const existingFingerprints = new Set(
      openaiConfigs.map((config) => getOpenaiConfigFingerprint(config)),
    );
    const usedIds = new Set(openaiConfigs.map((config) => config.id));
    let addedCount = 0;

    imported.forEach((item) => {
      if (!item || typeof item !== "object") return;
      const normalized = normalizeOpenaiConfig(item, usedIds);
      const fingerprint = getOpenaiConfigFingerprint(normalized);
      if (existingFingerprints.has(fingerprint)) return;
      openaiConfigs.push(normalized);
      existingFingerprints.add(fingerprint);
      addedCount++;
    });

    if (addedCount === 0) {
      showToast("没有可导入的新配置", "error");
      return;
    }

    await saveOpenaiConfigs();
    renderOpenaiList();
    if (!currentOpenaiId && openaiConfigs.length > 0) {
      selectOpenai(openaiConfigs[0].id);
    } else if (currentOpenaiId) {
      selectOpenai(currentOpenaiId);
    }
    showToast(`✓ 已导入 ${addedCount} 条配置`, "success");
  } catch (error) {
    console.error("导入 AI 配置失败:", error);
    showToast("导入失败：文件格式不正确", "error");
  }
}

/**
 * 保存 AI 配置（自动保存，同步第一项到 openaiConfig）
 */
async function saveOpenaiConfigs() {
  try {
    const storageData = { openaiConfigs };
    // 兼容：将第一项同步到 openaiConfig
    if (openaiConfigs.length > 0) {
      storageData.openaiConfig = {
        openaiApiKey: openaiConfigs[0].openaiApiKey,
        openaiBaseUrl: openaiConfigs[0].openaiBaseUrl,
        openaiModel: openaiConfigs[0].openaiModel,
      };
    } else {
      storageData.openaiConfig = DEFAULT_OPENAI_CONFIG;
    }
    await chrome.storage.sync.set(storageData);
  } catch (error) {
    console.error("保存 AI 配置失败:", error);
    showToast("保存失败", "error");
  }
}

/**
 * 根据 DOM 顺序重建 openaiConfigs 数组
 */
function reorderOpenaiConfigs() {
  const container = document.getElementById("openai-list");
  const items = container.querySelectorAll(".relay-item");
  const idOrder = Array.from(items).map((el) => el.dataset.id);
  const configMap = new Map(openaiConfigs.map((c) => [c.id, c]));
  openaiConfigs = idOrder.map((id) => configMap.get(id)).filter(Boolean);
}

/**
 * 渲染 AI 配置侧边栏列表
 */
function renderOpenaiList() {
  const container = document.getElementById("openai-list");
  if (!container) return;
  container.innerHTML = "";

  if (openaiConfigs.length === 0) {
    container.innerHTML =
      '<div style="color: #999; text-align: center; padding: 20px; font-size: 13px;">暂无配置</div>';
    return;
  }

  openaiConfigs.forEach((config, index) => {
    const el = document.createElement("div");
    el.className = `relay-item ${config.id === currentOpenaiId ? "active" : ""}`;
    el.dataset.id = config.id;
    el.draggable = true;

    const badge =
      config.type === "translate"
        ? '<span class="openai-default-badge" style="margin-right:4px;font-size:10px;">翻译</span>'
        : config.type === "dialog"
          ? '<span class="openai-default-badge" style="margin-right:4px;font-size:10px;">对话</span>'
          : "";
    el.innerHTML = `
      <span class="openai-drag-handle">≡</span>
      ${badge}<span class="relay-item-name" title="${escapeAttr(config.name)}">${escapeAttr(config.name) || "未命名配置"}</span>
      <span class="relay-item-copy" data-id="${config.id}" title="复制">复制</span>
      <span class="relay-item-delete" data-id="${config.id}" title="删除">删除</span>
    `;

    el.addEventListener("click", () => selectOpenai(config.id));

    const copyBtn = el.querySelector(".relay-item-copy");
    if (copyBtn) {
      copyBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        copyOpenaiItem(config.id);
      });
    }

    const delBtn = el.querySelector(".relay-item-delete");
    if (delBtn) {
      delBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        deleteOpenaiItem(config.id);
      });
    }

    // 拖拽排序事件
    el.addEventListener("dragstart", (e) => {
      openaiDragItem = el;
      el.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
    });

    el.addEventListener("dragend", () => {
      el.classList.remove("dragging");
      container
        .querySelectorAll(".relay-item")
        .forEach((item) => item.classList.remove("drag-over"));
      if (openaiDragItem) {
        openaiDragItem = null;
        // 根据 DOM 顺序重建数组，保存并刷新（更新默认标识）
        reorderOpenaiConfigs();
        saveOpenaiConfigs();
        renderOpenaiList();
        // 刷新右侧详情的默认标识
        if (currentOpenaiId) selectOpenai(currentOpenaiId);
      }
    });

    el.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (openaiDragItem && openaiDragItem !== el) {
        el.classList.add("drag-over");
      }
    });

    el.addEventListener("dragleave", () => {
      el.classList.remove("drag-over");
    });

    el.addEventListener("drop", (e) => {
      e.preventDefault();
      el.classList.remove("drag-over");
      if (openaiDragItem && openaiDragItem !== el) {
        const items = Array.from(container.querySelectorAll(".relay-item"));
        const fromIndex = items.indexOf(openaiDragItem);
        const toIndex = items.indexOf(el);
        if (fromIndex < toIndex) {
          container.insertBefore(openaiDragItem, el.nextSibling);
        } else {
          container.insertBefore(openaiDragItem, el);
        }
      }
    });

    container.appendChild(el);
  });
}

/**
 * 选择 AI 配置项，在右侧显示详情
 */
function selectOpenai(id) {
  currentOpenaiId = id;
  const emptyState = document.getElementById("openai-empty-state");
  const detailContainer = document.getElementById("openai-detail-container");
  if (!emptyState || !detailContainer) return;

  // 更新列表高亮
  document.querySelectorAll("#openai-list .relay-item").forEach((el) => {
    el.classList.toggle("active", el.dataset.id === id);
  });

  if (!id) {
    emptyState.style.display = "flex";
    detailContainer.style.display = "none";
    return;
  }

  emptyState.style.display = "none";
  detailContainer.style.display = "block";

  const config = openaiConfigs.find((c) => c.id === id);
  if (!config) return;

  document.getElementById("openaiName").value = config.name || "";
  document.getElementById("openaiType").value = config.type || "dialog";
  document.getElementById("openaiBaseUrl").value = config.openaiBaseUrl || "";
  document.getElementById("openaiApiKey").value = config.openaiApiKey || "";
  document.getElementById("openaiModel").value = config.openaiModel || "";

  // 移除默认标识相关代码
  const badge = document.getElementById("openai-detail-badge");
  if (badge) badge.style.display = "none";

  // 重置获取模型状态，并中断之前的测活任务
  currentGetModelsTaskId++;
  const statusEl = document.getElementById("openaiGetModelsStatus");
  const modelsListEl = document.getElementById("openaiModelsList");
  if (statusEl) statusEl.textContent = "";
  if (modelsListEl) {
    modelsListEl.style.display = "none";
    modelsListEl.innerHTML = "";
  }
}

/**
 * 保存当前选中的 AI 配置详情
 */
function saveOpenaiBasic(showToastMessage = true) {
  if (!currentOpenaiId) return;
  const config = openaiConfigs.find((c) => c.id === currentOpenaiId);
  if (!config) return;

  const newType = document.getElementById("openaiType").value;

  // 如果改为"翻译"类型，检查是否已有其他翻译配置
  if (newType === "translate" && config.type !== "translate") {
    const existingTranslate = openaiConfigs.find(
      (c) => c.id !== currentOpenaiId && c.type === "translate"
    );
    if (existingTranslate) {
      // 将已存在的翻译配置改为对话
      existingTranslate.type = "dialog";
      console.log(`[豆豆设置] 将配置"${existingTranslate.name}"从翻译改为对话`);
    }
  }

  config.name = document.getElementById("openaiName").value.trim();
  config.type = newType;
  config.openaiBaseUrl = document.getElementById("openaiBaseUrl").value.trim();
  config.openaiApiKey = document.getElementById("openaiApiKey").value.trim();
  config.openaiModel = document.getElementById("openaiModel").value.trim();

  saveOpenaiConfigs();
  renderOpenaiList(); // 名称可能改变，刷新列表
}

/**
 * 加载 AI 配置列表（含迁移逻辑）
 */
async function loadOpenaiList() {
  try {
    const result = await chrome.storage.sync.get([
      "openaiConfigs",
      "openaiConfig",
    ]);
    let configs = result.openaiConfigs;
    let shouldPersistConfigs = false;

    // 数据迁移：旧的单配置 → 新的多配置
    if (!configs && result.openaiConfig) {
      const old = result.openaiConfig;
      if (old.openaiApiKey || old.openaiBaseUrl || old.openaiModel) {
        configs = [
          createOpenaiConfig({
            id: generateId(),
            name: "默认配置",
            openaiApiKey: old.openaiApiKey || "",
            openaiBaseUrl: old.openaiBaseUrl || "",
            openaiModel: old.openaiModel || "",
          }),
        ];
        shouldPersistConfigs = true;
        await chrome.storage.sync.set({ openaiConfigs: configs });
      }
    }

    const { normalizedConfigs, changed } = normalizeOpenaiConfigs(
      configs || [],
    );
    openaiConfigs = normalizedConfigs;
    if (changed) {
      shouldPersistConfigs = true;
    }
    if (shouldPersistConfigs) {
      await saveOpenaiConfigs();
    }
    renderOpenaiList();
    if (openaiConfigs.length > 0) {
      if (
        !currentOpenaiId ||
        !openaiConfigs.find((c) => c.id === currentOpenaiId)
      ) {
        selectOpenai(openaiConfigs[0].id);
      } else {
        selectOpenai(currentOpenaiId);
      }
    } else {
      selectOpenai(null);
    }
  } catch (error) {
    console.error("加载 AI 配置失败:", error);
  }
}

/**
 * 添加 AI 配置项
 */
function addOpenaiItem() {
  const newId = generateId();
  openaiConfigs.push(
    createOpenaiConfig({
      id: newId,
      name: `配置 ${openaiConfigs.length + 1}`,
      openaiApiKey: "",
      openaiBaseUrl: "",
      openaiModel: "",
    }),
  );
  saveOpenaiConfigs();
  renderOpenaiList();
  selectOpenai(newId);
}

function copyOpenaiItem(id) {
  const index = openaiConfigs.findIndex((c) => c.id === id);
  if (index === -1) return;

  const config = openaiConfigs[index];
  const newId = generateId();
  const newConfig = createOpenaiConfig({
    ...config,
    id: newId,
    name: `${config.name || "未命名配置"}-复制`,
  });
  openaiConfigs.splice(index + 1, 0, newConfig);
  saveOpenaiConfigs();
  renderOpenaiList();
  selectOpenai(newId);
  showToast("已复制", "success");
}

/**
 * 删除 AI 配置项
 */
async function deleteOpenaiItem(id) {
  if (!id) return;
  const confirmed = await showConfirm("确认删除", "确定要删除该 AI 配置吗？");
  if (!confirmed) return;

  openaiConfigs = openaiConfigs.filter((c) => c.id !== id);
  saveOpenaiConfigs();
  renderOpenaiList();
  if (currentOpenaiId === id) {
    currentOpenaiId = openaiConfigs.length > 0 ? openaiConfigs[0].id : null;
    selectOpenai(currentOpenaiId);
  }
  showToast("已删除", "success");
}

/**
 * 测试当前选中的 AI 配置连接
 */
async function testOpenaiItem() {
  if (!currentOpenaiId) return;

  const apiKey = document.getElementById("openaiApiKey").value.trim();
  const baseUrl = document.getElementById("openaiBaseUrl").value.trim();
  const model = document.getElementById("openaiModel").value.trim();

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

  const testBtn = document.getElementById("openaiTestBtn");
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
 * 获取当前选中的 AI 配置的模型列表
 */
async function getOpenaiModels() {
  if (!currentOpenaiId) return;

  const apiKey = document.getElementById("openaiApiKey").value.trim();
  const baseUrl = document.getElementById("openaiBaseUrl").value.trim();

  if (!baseUrl) {
    showToast("请先填写 API Base URL", "error");
    return;
  }

  const getModelsBtn = document.getElementById("openaiGetModelsBtn");
  const statusEl = document.getElementById("openaiGetModelsStatus");
  const modelsListEl = document.getElementById("openaiModelsList");

  if (!getModelsBtn || !statusEl || !modelsListEl) return;

  // 递增任务 ID，生成当前调用的唯一标志
  currentGetModelsTaskId++;
  const taskId = currentGetModelsTaskId;

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

    modelsListEl.style.display = "grid";
    const badgeElements = [];

    models.forEach((m) => {
      const modelId = m.id;
      if (!modelId) return;

      const container = document.createElement("div");
      container.style.cssText = "display: flex; align-items: center; justify-content: space-between; border: 1px solid #d9d9d9; border-radius: 4px; background: #f5f5f5; transition: all 0.2s; overflow: hidden;";

      const badge = document.createElement("span");
      badge.className = "model-badge";
      badge.textContent = modelId;
      badge.dataset.status = "pending"; // 初始 pending 状态
      badge.style.cssText = "cursor: pointer; display: inline-block; padding: 4px 8px; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: calc(100% - 50px); flex: 1;";
      
      const testBtn = document.createElement("button");
      testBtn.className = "btn";
      testBtn.textContent = "测活";
      testBtn.style.cssText = "font-size: 12px; padding: 2px 6px; margin-right: 4px; border-radius: 4px; border: 1px solid #d9d9d9; background: #fff; cursor: pointer;";

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
        const modelInput = document.getElementById("openaiModel");
        if (modelInput) {
          modelInput.value = modelId;
          saveOpenaiBasic(false);
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

    if (currentGetModelsTaskId === taskId) {
      statusEl.textContent = `共获取 ${models.length} 个模型`;
    }

  } catch (error) {
    // 再次检查任务状态，防覆盖
    if (currentGetModelsTaskId === taskId) {
      statusEl.textContent = `获取失败: ${error.message}`;
      showToast(`获取模型失败: ${error.message}`, "error");
    }
  } finally {
    if (currentGetModelsTaskId === taskId) {
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

  // 事件绑定 - AI 配置
  const addOpenaiBtn = document.getElementById("addOpenaiBtn");
  if (addOpenaiBtn) addOpenaiBtn.addEventListener("click", addOpenaiItem);

  const exportOpenaiBtn = document.getElementById("exportOpenaiBtn");
  const importOpenaiBtn = document.getElementById("importOpenaiBtn");
  const importOpenaiFile = document.getElementById("importOpenaiFile");
  if (exportOpenaiBtn)
    exportOpenaiBtn.addEventListener("click", exportOpenaiConfigs);
  if (importOpenaiBtn)
    importOpenaiBtn.addEventListener("click", () => importOpenaiFile?.click());
  if (importOpenaiFile) {
    importOpenaiFile.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (file) {
        importOpenaiConfigs(file);
        importOpenaiFile.value = "";
      }
    });
  }

  // AI 配置详情：自动保存
  ["openaiType", "openaiName", "openaiBaseUrl", "openaiApiKey", "openaiModel"].forEach(
    (id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener("change", () => saveOpenaiBasic(false));
    },
  );

  const openaiTestBtn = document.getElementById("openaiTestBtn");
  if (openaiTestBtn) openaiTestBtn.addEventListener("click", testOpenaiItem);

  const openaiGetModelsBtn = document.getElementById("openaiGetModelsBtn");
  if (openaiGetModelsBtn) openaiGetModelsBtn.addEventListener("click", getOpenaiModels);

  const openaiDeleteBtn = document.getElementById("openaiDeleteBtn");
  if (openaiDeleteBtn)
    openaiDeleteBtn.addEventListener("click", () =>
      deleteOpenaiItem(currentOpenaiId),
    );

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

  // 事件绑定 - 爬虫规则添加
  const addCrawlerBtn = document.getElementById("addCrawlerBtn");

  // 事件绑定 - 爬虫规则导入导出
  const exportCrawlerBtn = document.getElementById("exportCrawlerBtn");
  const importCrawlerBtn = document.getElementById("importCrawlerBtn");
  const importCrawlerFile = document.getElementById("importCrawlerFile");
  const showCrawlerGuideBtn = document.getElementById("showCrawlerGuideBtn");
  const guideModal = document.getElementById("guide-modal");
  const closeGuideBtn = document.getElementById("btn-close-guide");

  if (showCrawlerGuideBtn && guideModal) {
    showCrawlerGuideBtn.addEventListener("click", () => {
      guideModal.style.display = "flex";
    });
  }

  if (closeGuideBtn && guideModal) {
    closeGuideBtn.addEventListener("click", () => {
      guideModal.style.display = "none";
    });
  }

  if (guideModal) {
    guideModal.addEventListener("click", (e) => {
      if (e.target === guideModal) {
        guideModal.style.display = "none";
      }
    });
  }

  if (exportCrawlerBtn)
    exportCrawlerBtn.addEventListener("click", exportCrawlerConfigs);
  if (importCrawlerBtn)
    importCrawlerBtn.addEventListener("click", () => importCrawlerFile.click());
  if (importCrawlerFile) {
    importCrawlerFile.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (file) {
        importCrawlerConfigs(file);
        importCrawlerFile.value = "";
      }
    });
  }

  if (addCrawlerBtn) {
    addCrawlerBtn.addEventListener("click", async () => {
      // 像 addOpenaiItem 一样，直接给 crawler_configs 增加一条空记录
      await addCrawlerConfig(
        "", // urlPattern
        "", // selector
        { mode: "static" }, // crawlMode
        "", // dateSelector
        "", // contentSelector
        "", // linkSelector
      );

      // 添加完毕且列表重新渲染后，焦点定位到最新的输入框上
      setTimeout(() => {
        const firstInput = document.querySelector(
          "#crawler-list .crawler-url-input",
        );
        if (firstInput) {
          firstInput.focus();
        }
      }, 100);
    });
  }

  // 加载设置
  loadSettings();
  loadOpenaiList();
  loadCorsSettings();

  // 显示版本号
  const versionEl = document.getElementById("app-version");
  if (versionEl) {
    const manifest = chrome.runtime.getManifest();
    versionEl.textContent = `版本 v${manifest.version}`;
  }

  // 加载交流群图片（防止缓存）
  const groupImg = document.getElementById("wechat-group-img");
  if (groupImg) {
    groupImg.src = `https://cdn.undsky.com/img/doudouqun.jpg?v=${Math.random()}`;
  }

  // 检查 URL hash，根据 hash 切换到对应 tab
  const hash = window.location.hash.slice(1);
  if (hash && document.getElementById(`${hash}-panel`)) {
    switchTab(hash);
  }
}

// 页面加载完成后初始化
document.addEventListener("DOMContentLoaded", init);
