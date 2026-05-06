/**
 * 采集创作功能
 * 配置链接，根据爬虫规则采集内容并转为 Markdown 下载
 */

import { showConfirm } from "../utils/ui.js";
import { OpenAIClient } from "../ai/openai.js";
import { collectFromRule, postToMarkdown } from "../crawler/generic.js";
import { sleep } from "../crawler/anti-detect.js";

const STORAGE_KEY = "xcom_collector_config";
let isCollecting = false;
let shouldStop = false;

// 内存中的完整配置
let currentConfig = { groups: [], dateStart: "", dateEnd: "" };
// 当前选中的分组索引
let selectedGroupIndex = -1;

// ============ 配置管理 ============

async function loadConfig() {
  const { [STORAGE_KEY]: config } = await chrome.storage.local.get(STORAGE_KEY);
  return withDefaultDateRange(config || { groups: [] });
}

async function saveConfig(config) {
  await chrome.storage.local.set({ [STORAGE_KEY]: config });
}

/** 从右侧详情面板读取当前选中分组的数据，同步回 currentConfig */
function syncDetailToConfig() {
  currentConfig.dateStart = document.getElementById("date-start").value;
  currentConfig.dateEnd = document.getElementById("date-end").value;

  if (
    selectedGroupIndex < 0 ||
    selectedGroupIndex >= currentConfig.groups.length
  )
    return;

  const detail = document.getElementById("group-detail");
  const nameInput = document.querySelector(
    `.group-list-item[data-index="${selectedGroupIndex}"] .group-name-input`,
  );

  const name = nameInput?.value.trim() || "";
  const links = [];
  detail.querySelectorAll(".link-item .input").forEach((input) => {
    const val = input.value.trim();
    if (val) links.push(val);
  });

  const aiPrompt =
    detail.querySelector(".ai-prompt-textarea")?.value?.trim() || "";
  currentConfig.groups[selectedGroupIndex] = {
    ...currentConfig.groups[selectedGroupIndex],
    name: name || "未命名分组",
    links,
    aiPrompt,
  };
}

// ============ UI 渲染 ============

/** 渲染左侧分组列表 */
function renderGroupList() {
  const container = document.getElementById("group-list");
  const emptyState = document.getElementById("empty-groups");

  container.innerHTML = "";

  if (currentConfig.groups.length === 0) {
    emptyState.classList.remove("hidden");
    selectedGroupIndex = -1;
    renderGroupDetail();
    return;
  }

  emptyState.classList.add("hidden");

  currentConfig.groups.forEach((group, index) => {
    const item = document.createElement("div");
    item.className =
      "group-list-item" + (index === selectedGroupIndex ? " active" : "");
    item.dataset.index = index;

    const linkCount = group.links.filter(Boolean).length;
    item.innerHTML = `
      <input type="text" class="group-name-input" value="${escapeHTML(group.name || "未命名分组")}" placeholder="分组名称" />
      <span class="link-count">${linkCount}</span>
      <button class="btn-danger remove-group-btn" title="删除分组">✕</button>
    `;

    item.addEventListener("click", (e) => {
      if (e.target.closest(".remove-group-btn")) return;
      selectGroup(index);
    });

    item.querySelector(".group-name-input").addEventListener("input", (e) => {
      currentConfig.groups[index].name = e.target.value.trim() || "未命名分组";
      autoSave();
    });

    item
      .querySelector(".remove-group-btn")
      .addEventListener("click", async (e) => {
        e.stopPropagation();
        const groupName = group.name || "未命名分组";
        if (!(await showConfirm(`确定要删除分组「${groupName}」吗？`))) return;

        currentConfig.groups.splice(index, 1);
        // 调整选中索引
        if (selectedGroupIndex === index) {
          selectedGroupIndex =
            currentConfig.groups.length > 0
              ? Math.min(index, currentConfig.groups.length - 1)
              : -1;
        } else if (selectedGroupIndex > index) {
          selectedGroupIndex--;
        }
        saveConfig(currentConfig);
        renderGroupList();
        renderGroupDetail();
      });

    container.appendChild(item);
  });
}

/** 选中一个分组 */
function selectGroup(index) {
  // 先同步当前分组的数据
  syncDetailToConfig();

  selectedGroupIndex = index;

  // 更新左侧高亮
  document.querySelectorAll(".group-list-item").forEach((item, i) => {
    item.classList.toggle("active", i === index);
  });

  renderGroupDetail();
}

/** 渲染右侧详情面板 */
function renderGroupDetail() {
  const detail = document.getElementById("group-detail");
  const emptyDetail = document.getElementById("empty-detail");

  if (
    selectedGroupIndex < 0 ||
    selectedGroupIndex >= currentConfig.groups.length
  ) {
    detail.innerHTML = "";
    emptyDetail.classList.remove("hidden");
    return;
  }

  emptyDetail.classList.add("hidden");
  const group = currentConfig.groups[selectedGroupIndex];

  let linksHTML = "";
  if (group.links.length === 0) {
    linksHTML = createLinkItemHTML("");
  } else {
    group.links.forEach((link) => {
      linksHTML += createLinkItemHTML(link);
    });
  }

  detail.innerHTML = `
    <div class="detail-body">
      <div class="detail-left">
        <div class="detail-left-header">
          <h3>链接列表</h3>
          <div class="link-actions">
            <button class="btn btn-primary" id="detail-add-link" style="font-size: 13px; padding: 6px 16px">添加链接</button>
            <button class="btn export-links-btn" style="font-size: 13px; padding: 6px 16px">导出</button>
            <button class="btn import-links-btn" style="font-size: 13px; padding: 6px 16px">导入</button>
          </div>
        </div>
        <div class="link-list">
          ${linksHTML}
        </div>
      </div>

      <div class="detail-right">
        <div class="detail-right-header">
          <button class="btn btn-primary btn-sm collect-group-btn">🚀 采集创作</button>
        </div>
        <div class="log-container hidden ai-prompt-section"></div>

        <div class="ai-prompt-section">
          <h3>AI文章生成提示词（选填）</h3>
          <textarea class="input input-full ai-prompt-textarea" rows="33" placeholder="填写提示词后，将通过 AI 生成文章">${escapeHTML(group.aiPrompt || "")}</textarea>
        </div>
      </div>
    </div>
  `;

  // 绑定事件
  bindDetailEvents();
}

/** 绑定右侧详情面板的事件 */
function bindDetailEvents() {
  const detail = document.getElementById("group-detail");

  // 添加链接
  detail.querySelector("#detail-add-link").addEventListener("click", () => {
    const linkList = detail.querySelector(".link-list");
    const item = createLinkItem("");
    linkList.prepend(item);
    autoSave();
  });

  // 删除链接按钮（事件委托，覆盖已有和新增链接）
  detail.querySelector(".link-list").addEventListener("click", async (e) => {
    const btn = e.target.closest(".remove-link");
    if (!btn) return;
    if (!(await showConfirm("确定要删除该链接吗？"))) return;
    btn.closest(".link-item").remove();
    syncDetailToConfig();
    updateSidebarLinkCount();
    autoSave();
  });

  // 链接输入变化（事件委托，覆盖已有和新增链接）
  detail.querySelector(".link-list").addEventListener("change", async (e) => {
    if (!e.target.matches(".link-item .input")) return;
    const url = e.target.value.trim();
    if (url) {
      clearTimeout(saveTimer);
      const matched = await matchCrawlerRule(url);
      if (!matched) {
        const ok = await showConfirm(
          "请先设置爬虫规则，点击确定跳转到设置页面",
          "提示",
          "primary",
        );
        if (ok) {
          chrome.tabs.create({ url: "src/settings.html#crawlers" });
        }
        e.target.value = "";
      }
    }
    syncDetailToConfig();
    updateSidebarLinkCount();
    autoSave();
  });

  // 导出
  detail.querySelector(".export-links-btn").addEventListener("click", () => {
    syncDetailToConfig();
    const group = currentConfig.groups[selectedGroupIndex];
    exportGroupData(group);
  });

  // 导入
  detail.querySelector(".import-links-btn").addEventListener("click", () => {
    importGroupData();
  });

  // AI 提示词变化
  detail
    .querySelector(".ai-prompt-textarea")
    .addEventListener("change", autoSave);
  // 采集按钮
  detail.querySelector(".collect-group-btn").onclick = () => {
    startCollect(selectedGroupIndex);
  };
}

/** 更新左侧分组的链接数量 */
function updateSidebarLinkCount() {
  if (selectedGroupIndex < 0) return;
  const group = currentConfig.groups[selectedGroupIndex];
  if (!group) return;
  const listItems = document.querySelectorAll(".group-list-item");
  if (listItems[selectedGroupIndex]) {
    const count = group.links.filter(Boolean).length;
    listItems[selectedGroupIndex].querySelector(".link-count").textContent =
      count;
  }
}

function createLinkItemHTML(value) {
  return `
    <div class="link-item">
      <input type="text" class="input" value="${escapeHTML(value)}" placeholder="请输入链接" />
      <button class="btn-danger remove-link" title="删除">✕</button>
    </div>
  `;
}

function createLinkItem(value) {
  const item = document.createElement("div");
  item.className = "link-item";
  item.innerHTML = `
    <input type="text" class="input" value="${escapeHTML(value)}" placeholder="请输入链接" />
    <button class="btn-danger remove-link" title="删除">✕</button>
  `;
  return item;
}

function getUrlFormat(urlStr) {
  const u = new URL(urlStr);
  const pathDepth = u.pathname
    .replace(/\/+$/, "")
    .split("/")
    .filter(Boolean).length;
  const paramKeys = [...u.searchParams.keys()].sort().join(",");
  return `${u.origin}|${pathDepth}|${paramKeys}`;
}

async function matchCrawlerRule(url) {
  try {
    const inputFormat = getUrlFormat(url);
    const { crawler_configs = [] } =
      await chrome.storage.local.get("crawler_configs");
    return (
      crawler_configs.find((config) => {
        try {
          return getUrlFormat(config.urlPattern) === inputFormat;
        } catch {
          return false;
        }
      }) || null
    );
  } catch {
    return null;
  }
}

let saveTimer = null;
function autoSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    syncDetailToConfig();
    saveConfig(currentConfig);
  }, 500);
}

function escapeHTML(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ============ 导入导出 ============

function exportGroupData(group) {
  const data = {
    links: group.links,
    aiPrompt: group.aiPrompt || "",
  };

  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${group.name || "未命名分组"}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importGroupData() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json";
  input.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = JSON.parse(evt.target.result);
        const links = Array.isArray(data.links)
          ? data.links.filter(Boolean)
          : [];

        // 更新当前分组的数据
        const group = currentConfig.groups[selectedGroupIndex];
        if (!group) return;

        group.links = links.length > 0 ? links : [""];
        if (data.aiPrompt != null) group.aiPrompt = data.aiPrompt;

        saveConfig(currentConfig);
        renderGroupDetail();
        updateSidebarLinkCount();
      } catch (err) {
        alert("导入失败：文件格式不正确");
      }
    };
    reader.readAsText(file);
  });
  input.click();
}

// ============ 日志 ============

function log(message, type = "") {
  const detail = document.getElementById("group-detail");
  const container = detail.querySelector(".log-container");
  if (!container) return;

  container.classList.remove("hidden");

  const entry = document.createElement("div");
  entry.className = `log-entry ${type}`;
  const time = new Date().toLocaleTimeString();
  entry.textContent = `[${time}] ${message}`;
  container.appendChild(entry);
  container.scrollTop = container.scrollHeight;
}

// ============ 采集核心 ============

async function startCollect(groupIndex) {
  syncDetailToConfig();
  await saveConfig(currentConfig);

  const group = currentConfig.groups[groupIndex];
  if (!group) {
    log("分组不存在", "error");
    return;
  }

  const links = group.links.filter(Boolean);
  if (links.length === 0) {
    log("请至少添加一个创作者链接", "error");
    return;
  }

  if (!currentConfig.dateStart || !currentConfig.dateEnd) {
    log("请选择完整的开始日期和结束日期", "error");
    return;
  }

  if (currentConfig.dateStart > currentConfig.dateEnd) {
    log("开始日期不能晚于结束日期", "error");
    return;
  }

  isCollecting = true;
  shouldStop = false;

  // UI 状态切换
  const detail = document.getElementById("group-detail");
  const collectBtn = detail.querySelector(".collect-group-btn");
  if (collectBtn) {
    collectBtn.textContent = "⏹ 停止";
    collectBtn.classList.remove("btn-primary");
    collectBtn.classList.add("btn-secondary");
    collectBtn.onclick = () => {
      shouldStop = true;
      log("正在停止采集...", "info");
    };
  }

  // 清空日志
  const logContainer = detail.querySelector(".log-container");
  if (logContainer) logContainer.innerHTML = "";

  log("开始采集...", "info");

  const allPosts = [];
  let current = 0;
  const total = links.length;

  for (const link of links) {
    if (shouldStop) break;

    current++;
    log(`采集创作者: ${link}`, "info");

    try {
      const { dateStart, dateEnd } = getDateRange(currentConfig);

      const rule = await matchCrawlerRule(link);
      if (!rule) {
        log(`未找到匹配的爬虫规则: ${link}，跳过`, "error");
        continue;
      }

      const posts = await collectFromRule(link, rule, dateStart, dateEnd, {
        onLog: (msg, type) => log(msg, type),
        shouldStop: () => shouldStop,
      });
      allPosts.push(...posts);
    } catch (err) {
      log(`采集失败: ${err.message}`, "error");
    }

    if (current < total && !shouldStop) {
      const creatorRestTime = Math.floor(Math.random() * 5000) + 5000;
      log(
        `切换创作者，休息 ${Math.round(creatorRestTime / 1000)} 秒...`,
        "info",
      );
      await sleep(creatorRestTime);
    }
  }

  let aiResult = null;

  if (allPosts.length > 0) {
    let markdown = `# 采集结果 - ${group.name}\n\n`;
    markdown += `> 采集时间: ${new Date().toLocaleString("zh-CN")}\n`;
    markdown += `> 时间范围: ${currentConfig.dateStart} 至 ${currentConfig.dateEnd}\n`;
    markdown += `> 共 ${allPosts.length} 条帖子\n\n---\n\n`;

    allPosts.forEach((post) => {
      markdown += postToMarkdown(post);
    });

    const now = new Date();
    const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
    const safeName =
      group.name.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, "_") || "group";
    const filename = `${safeName}_${dateStr}.md`;

    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);

    log(
      `采集完成！共 ${allPosts.length} 条帖子，已下载为 ${filename}`,
      "success",
    );

    // ============ AI 文章生成 ============
    try {
      log("正在生成 AI 文章...", "info");

      const client = await OpenAIClient.fromStorage();
      if (!client) {
        log("未配置 OpenAI，跳过 AI 文章生成", "info");
      } else if (!group.aiPrompt) {
        log("当前分组未配置AI提示词，跳过 AI 文章生成", "info");
      } else {
        const systemPrompt = group.aiPrompt;
        aiResult = await client.chat(markdown, { systemPrompt });

        if (aiResult) {
          const newPostId = crypto.randomUUID();
          const postNow = new Date();
          const postDateStr = postNow.toLocaleString("zh-CN");

          const newPost = {
            id: newPostId,
            title: `AI 文章 - ${group.name} - ${postDateStr}`,
            content: aiResult,
            history: [{ datetime: postDateStr, content: aiResult }],
            createDatetime: postNow.toISOString(),
            updateDatetime: postNow.toISOString(),
            parentId: null,
          };

          await chrome.storage.local.set({ pending_post_import: newPost });
          chrome.tabs.create({
            url: chrome.runtime.getURL(
              "md/index.html?source=background_import",
            ),
          });

          log("AI 文章生成成功，已打开编辑器", "success");
        } else {
          log("AI 文章生成失败：返回结果为空", "error");
        }
      }
    } catch (aiErr) {
      log(`AI 文章生成失败: ${aiErr.message}`, "error");
    }
  } else {
    log("未采集到任何帖子", "error");
  }

  isCollecting = false;

  // 恢复按钮状态
  if (collectBtn) {
    collectBtn.textContent = "🚀 采集创作";
    collectBtn.classList.remove("btn-secondary");
    collectBtn.classList.add("btn-primary");
    collectBtn.onclick = () => startCollect(groupIndex);
  }
}

// ============ 初始化 ============

function formatDateInput(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function getDefaultDateRange() {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 1);
  return {
    dateStart: formatDateInput(start),
    dateEnd: formatDateInput(end),
  };
}

function withDefaultDateRange(config) {
  const defaults = getDefaultDateRange();
  return {
    ...config,
    dateStart: config.dateStart || defaults.dateStart,
    dateEnd: config.dateEnd || defaults.dateEnd,
  };
}

function getDateRange(config) {
  return {
    dateStart: new Date(`${config.dateStart}T00:00:00`).toISOString(),
    dateEnd: new Date(`${config.dateEnd}T23:59:59.999`).toISOString(),
  };
}

document.addEventListener("DOMContentLoaded", async () => {
  currentConfig = await loadConfig();

  // 设置时间范围
  document.getElementById("date-start").value = currentConfig.dateStart;
  document.getElementById("date-end").value = currentConfig.dateEnd;

  // 渲染左侧分组列表
  renderGroupList();

  // 默认选中第一个分组
  if (currentConfig.groups.length > 0) {
    selectGroup(0);
  }

  // 时间范围变化自动保存
  document.getElementById("date-start").addEventListener("change", autoSave);
  document.getElementById("date-end").addEventListener("change", autoSave);

  // 添加分组
  document.getElementById("add-group").addEventListener("click", () => {
    // 先同步当前分组
    syncDetailToConfig();

    const newGroup = {
      name: "",
      links: [""],
      collapsed: false,
      aiPrompt: "",
    };
    currentConfig.groups.push(newGroup);
    saveConfig(currentConfig);

    // 渲染列表并选中新分组
    const newIndex = currentConfig.groups.length - 1;
    selectedGroupIndex = newIndex;
    renderGroupList();
    renderGroupDetail();

    // 聚焦到新分组的名称输入框
    const nameInput = document.querySelector(
      `.group-list-item[data-index="${selectedGroupIndex}"] .group-name-input`,
    );
    if (nameInput) nameInput.focus();
  });
});
