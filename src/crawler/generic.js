/**
 * 通用采集核心逻辑
 * 根据 crawler_configs 规则采集任意网站，支持 static/scroll/pagination 三种模式
 */

import {
  sleep,
  randomDelay,
  exponentialBackoff,
  simulateHumanBehavior,
} from "./anti-detect.js";

// ============ 页面状态检测 ============

/**
 * 通用页面状态检测
 * @param {number} tabId Chrome 标签页 ID
 * @param {string} selector 内容选择器
 * @returns {Promise<"ok"|"rate_limited"|"loading"|"error">}
 */
async function checkPageStatus(tabId, selector) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: (sel) => {
        // const body = document.body?.innerText || "";
        // if (
        //   body.includes("403") ||
        //   body.includes("Access Denied") ||
        //   body.includes("Rate limit") ||
        //   body.includes("Too Many Requests") ||
        //   body.includes("blocked")
        // ) {
        //   return "rate_limited";
        // }
        let found = false;
        if (sel) {
          try {
            const selectors = sel.split(",").map((s) => s.trim()).filter(Boolean);
            for (const s of selectors) {
              if (document.querySelector(s)) {
                found = true;
                break;
              }
            }
          } catch (e) {
            try {
              if (document.querySelectorAll(sel).length > 0) {
                found = true;
              }
            } catch (err) {}
          }
        } else {
          return document.readyState === "complete" ? "ok" : "loading";
        }
        
        if (found) return "ok";
        return "loading";
      },
      args: [selector],
    });
    return results?.[0]?.result || "ok";
  } catch {
    return "error";
  }
}

/**
 * 通用页面就绪等待
 * @param {number} tabId Chrome 标签页 ID
 * @param {string} selector 内容选择器
 * @param {Object} [options]
 * @param {number} [options.maxRetries=3]
 * @param {function} [options.onLog]
 */
async function waitForGenericPageReady(tabId, selector, options = {}) {
  const { maxRetries = 3, onLog } = options;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    await randomDelay(3000, 5000);
    const status = await checkPageStatus(tabId, selector);
    if (status === "ok") return true;
    if (status === "rate_limited") {
      const backoffMs = Math.floor(
        5000 * Math.pow(2, attempt) * (0.5 + Math.random() * 0.5),
      );
      onLog?.(
        `页面异常，等待 ${Math.round(backoffMs / 1000)} 秒后重试 (${attempt + 1}/${maxRetries})...`,
        "error",
      );
      await sleep(backoffMs);
      try {
        await chrome.tabs.reload(tabId);
      } catch {}
      continue;
    }
    if (status === "loading" || status === "error") {
      await randomDelay(1000, 3000);
      continue;
    }
    return false;
  }

  // 超过重试次数后，如果页面本身已经完全加载，则视为准备就绪（可能真的没有内容）
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => document.readyState === "complete"
    });
    if (results?.[0]?.result) {
      return true;
    }
  } catch (e) {}

  return false;
}

// ============ 页面操作 ============

/**
 * 滚动页面
 * @param {number} tabId
 * @param {number} distance 滚动距离（px）
 */
async function scrollPage(tabId, distance) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (dist) => {
      window.scrollBy({
        top: dist + Math.random() * 200,
        behavior: "smooth",
      });
    },
    args: [distance],
  });
}

/**
 * 分页跳转：<a> 标签用导航，其他元素用 click
 * @param {number} tabId
 * @param {string} paginationSelector 分页选择器
 * @returns {Promise<boolean>} 是否成功跳转
 */
async function goToNextPage(tabId, paginationSelector) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (sel) => {
      const el = document.querySelector(sel);
      if (!el) return { found: false };
      if (el.tagName === "A" && el.href) {
        return { found: true, type: "link", url: el.href };
      }
      el.click();
      return { found: true, type: "click" };
    },
    args: [paginationSelector],
  });

  const result = results?.[0]?.result;
  if (!result?.found) return null;

  if (result.type === "link") {
    await chrome.tabs.update(tabId, { url: result.url });
    return result.url;
  }
  // click 方式跳转，返回空字符串表示成功但无明确 URL
  return "";
}

// ============ 页面注入函数 ============

/**
 * 注入到页面 - 采集列表项
 * @param {string} selector 列表项选择器
 * @param {string} dateSelector 日期选择器（相对于列表项）
 * @param {string} dateStart ISO 日期字符串
 * @param {string} dateEnd ISO 日期字符串
 * @returns {{ items: Array<{url: string, date: string|null}>, reachedBefore: boolean }}
 */
function _collectItemsInjected(
  selector,
  dateSelector,
  dateStart,
  dateEnd,
  linkSelector,
) {
  const items = [];
  // let reachedBefore = false;
  const containers = document.querySelectorAll(selector);
  const pageUrl = window.location.href.split("#")[0];

  function parseDateValue(el, attr) {
    // 策略 1：属性值（自定义 attr）
    if (attr) {
      const dt = el.getAttribute(attr);
      if (dt) {
        const d = new Date(dt);
        if (!isNaN(d.getTime())) return d.toISOString();
      }
    }

    const text = el.textContent.trim();

    // 策略 2：直接 Date.parse
    const d = new Date(text);
    if (!isNaN(d.getTime())) return d.toISOString();

    // 策略 3：相对时间（中文）
    const relativePatterns = [
      { regex: /(\d+)\s*秒前/, unit: 1000 },
      { regex: /(\d+)\s*分钟前/, unit: 60 * 1000 },
      { regex: /(\d+)\s*小时前/, unit: 3600 * 1000 },
      { regex: /(\d+)\s*天前/, unit: 86400 * 1000 },
      { regex: /(\d+)\s*周前/, unit: 7 * 86400 * 1000 },
    ];
    for (const { regex, unit } of relativePatterns) {
      const m = text.match(regex);
      if (m) return new Date(Date.now() - parseInt(m[1]) * unit).toISOString();
    }

    // 策略 4：常见日期格式 YYYY-MM-DD / YYYY/MM/DD / YYYY年MM月DD日
    const dateRegex = /(\d{4})[年/\-](\d{1,2})[月/\-](\d{1,2})/;
    const dateMatch = text.match(dateRegex);
    if (dateMatch) {
      return new Date(
        parseInt(dateMatch[1]),
        parseInt(dateMatch[2]) - 1,
        parseInt(dateMatch[3]),
      ).toISOString();
    }

    // 策略 5: MM-DD (当年)
    const shortDateRegex = /(\d{1,2})[月\-/](\d{1,2})[日]?$/;
    const shortMatch = text.match(shortDateRegex);
    if (shortMatch) {
      return new Date(
        new Date().getFullYear(),
        parseInt(shortMatch[1]) - 1,
        parseInt(shortMatch[2]),
      ).toISOString();
    }

    return null;
  }

  // 解析 dateSelector：支持 selector$attr 格式
  let actualDateSelector = dateSelector;
  let dateAttr = "";
  if (dateSelector) {
    const lastDollar = dateSelector.lastIndexOf("$");
    if (lastDollar !== -1) {
      actualDateSelector = dateSelector.substring(0, lastDollar);
      dateAttr = dateSelector.substring(lastDollar + 1);
    }
  }

  containers.forEach((container) => {
    try {
      // 日期过滤
      if (dateSelector) {
        const dateEl = container.querySelector(actualDateSelector);
        if (dateEl) {
          const datetime = parseDateValue(dateEl, dateAttr);
          if (datetime) {
            if (dateStart && datetime < dateStart) {
              // reachedBefore = true;
              return;
            }
            if (dateEnd && datetime > dateEnd) return;
          }
        }
      }

      // 提取链接
      let anchor = null;
      if (linkSelector) {
        const el = container.querySelector(linkSelector);
        if (el) {
          anchor =
            el.tagName === "A" && el.href ? el : el.querySelector("a[href]");
        }
      } else {
        anchor = container.querySelector("a[href]");
      }
      if (anchor) {
        const href = anchor.href;
        if (
          href &&
          href.startsWith("http") &&
          href !== pageUrl &&
          !href.startsWith(pageUrl + "#") &&
          !items.find((i) => i.url === href)
        ) {
          let date = null;
          if (dateSelector) {
            const dateEl = container.querySelector(actualDateSelector);
            if (dateEl) date = parseDateValue(dateEl, dateAttr);
          }
          items.push({ url: href, date });
        }
      }
    } catch (e) {
      // skip
    }
  });

  return { items, reachedBefore: items.length == 0 };
}

/**
 * 注入到详情页 - 获取内容并转 Markdown
 * @param {string} contentSelector 内容选择器
 * @returns {{ markdown: string } | null}
 */
function collectDetailContent(contentSelector) {
  try {
    if (typeof TurndownService === "undefined") return null;
    const turndown = new TurndownService();
    if (typeof addTurndownRules === "function") {
      addTurndownRules(turndown);
    }
    // 支持逗号分隔的多个选择器
    const selectors = contentSelector
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const parts = [];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        const clone = el.cloneNode(true);
        parts.push(turndown.turndown(clone.innerHTML));
      }
    }
    if (parts.length === 0) return null;
    return { markdown: parts.join("\n\n") };
  } catch (e) {
    return null;
  }
}

// ============ 列表采集辅助 ============

/**
 * 在标签页中执行列表采集
 */
async function collectItemsFromPage(
  tabId,
  selector,
  dateSelector,
  dateStart,
  dateEnd,
  linkSelector,
) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: _collectItemsInjected,
    args: [
      selector,
      dateSelector || "",
      dateStart,
      dateEnd,
      linkSelector || "",
    ],
  });
  return results?.[0]?.result || { items: [], reachedBefore: false };
}

// ============ 核心采集函数 ============

/**
 * 根据爬虫规则采集内容
 * @param {string} url 采集页面链接
 * @param {Object} rule 爬虫规则配置
 * @param {string} rule.selector 列表项选择器
 * @param {string} rule.dateSelector 日期选择器
 * @param {string} rule.contentSelector 内容选择器
 * @param {Object} rule.crawlMode 爬取模式配置
 * @param {string} dateStart ISO 日期字符串
 * @param {string} dateEnd ISO 日期字符串
 * @param {Object} [options]
 * @param {function} [options.onLog] 日志回调
 * @param {function} [options.shouldStop] 停止标志
 * @returns {Promise<Array>} 采集到的内容数组
 */
export async function collectFromRule(
  url,
  rule,
  dateStart,
  dateEnd,
  options = {},
) {
  const { onLog = () => {}, shouldStop = () => false } = options;
  const {
    selector,
    linkSelector,
    dateSelector,
    contentSelector,
    crawlMode = { mode: "static" },
  } = rule;

  onLog(`正在打开: ${url}`, "info");
  const tab = await chrome.tabs.create({ url, active: true });

  // 仅有 contentSelector 无 selector：直接采集当前页面内容
  if (!selector && contentSelector) {
    onLog(`仅配置了内容选择器，直接采集当前页面内容...`, "info");
    const waitSelector = contentSelector.split(",")[0].trim();
    const pageReady = await waitForGenericPageReady(tab.id, waitSelector, {
      onLog: (msg, type) => onLog(msg, type),
    });
    if (!pageReady) {
      onLog(`页面加载失败，跳过`, "error");
      try {
        await chrome.tabs.remove(tab.id);
      } catch {}
      return [];
    }
    await simulateHumanBehavior(tab.id, "read");

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["md/static/js/turndown.js", "src/utils/turndown-rules.js"],
    });

    let detail = null;
    for (let retry = 0; retry < 3; retry++) {
      const detailResults = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: collectDetailContent,
        args: [contentSelector],
      });
      detail = detailResults?.[0]?.result;
      if (detail) break;
      onLog(`提取失败，第 ${retry + 1} 次重试...`, "error");
      await exponentialBackoff(retry, 3000, 15000);
    }

    try {
      await chrome.tabs.remove(tab.id);
    } catch {}

    if (detail) {
      onLog(`页面内容采集成功`, "success");
      return [{ url, ...detail }];
    } else {
      onLog(`页面内容采集失败`, "error");
      return [];
    }
  }

  onLog(`等待页面加载...`, "info");
  const pageReady = await waitForGenericPageReady(tab.id, selector, {
    onLog: (msg, type) => onLog(msg, type),
  });
  if (!pageReady) {
    onLog(`页面加载失败，跳过`, "error");
    try {
      await chrome.tabs.remove(tab.id);
    } catch {}
    return [];
  }
  onLog(`页面加载完成`, "success");

  onLog(`模拟浏览行为...`, "info");
  await simulateHumanBehavior(tab.id, "browse");
  await randomDelay(1000, 3000);

  try {
    const collectedUrls = new Set();
    const allItems = [];
    let reachedBefore = false;

    // ======== 阶段一：列表采集 ========

    if (crawlMode.mode === "static") {
      // 仅爬取：查询一次
      onLog(`模式: 仅爬取，正在采集页面内容...`, "info");
      const result = await collectItemsFromPage(
        tab.id,
        selector,
        dateSelector,
        dateStart,
        dateEnd,
        linkSelector,
      );
      result.items.forEach((item) => {
        if (!collectedUrls.has(item.url)) {
          collectedUrls.add(item.url);
          allItems.push(item);
        }
      });
      reachedBefore = result.reachedBefore;
      onLog(`页面采集完成，发现 ${allItems.length} 条内容`, "info");
    } else if (crawlMode.mode === "scroll") {
      // 滚动模式
      const maxScrolls = crawlMode.scrollCount || 5;
      const scrollDistance = crawlMode.scrollDistance || 800;
      let scrollAttempts = 0;
      let noNewItemsCount = 0;

      onLog(
        `模式: 滚动，每次 ${scrollDistance}px，最多 ${maxScrolls} 次`,
        "info",
      );

      while (
        !reachedBefore &&
        !shouldStop() &&
        scrollAttempts < maxScrolls &&
        noNewItemsCount < 2
      ) {
        scrollAttempts++;
        onLog(`第 ${scrollAttempts}/${maxScrolls} 次滚动，正在采集...`, "info");

        const result = await collectItemsFromPage(
          tab.id,
          selector,
          dateSelector,
          dateStart,
          dateEnd,
          linkSelector,
        );

        const newItems = result.items.filter((i) => !collectedUrls.has(i.url));
        newItems.forEach((item) => {
          collectedUrls.add(item.url);
          allItems.push(item);
        });

        if (newItems.length > 0) {
          onLog(
            `本次新增 ${newItems.length} 条，累计 ${allItems.length} 条`,
            "",
          );
          noNewItemsCount = 0;
        } else {
          noNewItemsCount++;
          onLog(`本次未发现新内容 (${noNewItemsCount}/2)`, "info");
        }

        if (result.reachedBefore) {
          onLog(`已到达时间范围之前的内容，停止滚动`, "info");
          reachedBefore = true;
          break;
        }

        // 滚动
        onLog(`向下滚动 ${scrollDistance}px...`, "info");
        await scrollPage(tab.id, scrollDistance);
        await simulateHumanBehavior(tab.id, "browse");
        await randomDelay(3000, 5000);

        // 页面状态检测
        const status = await checkPageStatus(tab.id, selector);
        if (status === "rate_limited") {
          onLog(`检测到页面异常，等待恢复...`, "error");
          await exponentialBackoff(scrollAttempts, 10000, 60000);
          try {
            await chrome.tabs.reload(tab.id);
          } catch {}
          // await randomDelay(5000, 8000);
          onLog(`页面已重新加载，继续采集`, "info");
        }
      }

      if (noNewItemsCount >= 2) {
        onLog(`连续 2 次无新内容，停止滚动`, "info");
      }
      if (scrollAttempts >= maxScrolls) {
        onLog(`已达到最大滚动次数 ${maxScrolls}`, "info");
      }
    } else if (crawlMode.mode === "pagination") {
      // 分页模式
      const maxPages = crawlMode.paginationCount || 5;
      const paginationSelector = crawlMode.paginationSelector;
      let pageCount = 0;
      let noNewItemsCount = 0;

      onLog(`模式: 分页，最多 ${maxPages} 页`, "info");

      while (
        !reachedBefore &&
        !shouldStop() &&
        pageCount < maxPages &&
        noNewItemsCount < 2
      ) {
        onLog(`正在采集第 ${pageCount + 1} 页...`, "info");

        const result = await collectItemsFromPage(
          tab.id,
          selector,
          dateSelector,
          dateStart,
          dateEnd,
          linkSelector,
        );

        const newItems = result.items.filter((i) => !collectedUrls.has(i.url));
        newItems.forEach((item) => {
          collectedUrls.add(item.url);
          allItems.push(item);
        });

        if (newItems.length > 0) {
          onLog(
            `本页新增 ${newItems.length} 条，累计 ${allItems.length} 条`,
            "",
          );
          noNewItemsCount = 0;
        } else {
          noNewItemsCount++;
          onLog(`本页未发现新内容 (${noNewItemsCount}/2)`, "info");
        }

        if (result.reachedBefore) {
          onLog(`已到达时间范围之前的内容，停止翻页`, "info");
          reachedBefore = true;
          break;
        }

        // 跳转下一页
        onLog(`正在跳转到下一页...`, "info");
        const nextUrl = await goToNextPage(tab.id, paginationSelector);
        if (nextUrl == null) {
          onLog(`未找到分页元素或已到最后一页`, "info");
          break;
        }
        pageCount++;
        onLog(
          `已跳转到第 ${pageCount + 1} 页${nextUrl ? `：${nextUrl}` : ""}，等待加载...`,
          "info",
        );

        // await randomDelay(3000, 5000);
        await waitForGenericPageReady(tab.id, selector, {
          onLog,
          maxRetries: 3,
        });
        await simulateHumanBehavior(tab.id, "browse");
      }

      if (pageCount >= maxPages) {
        onLog(`已达到最大翻页次数 ${maxPages}`, "info");
      }
    }

    onLog(`阶段一完成，共找到 ${allItems.length} 条内容`, "success");

    // ======== 阶段二：详情采集 ========

    const detailedItems = [];

    if (contentSelector) {
      onLog(`开始阶段二：逐个采集详情（共 ${allItems.length} 条）...`, "info");

      for (let i = 0; i < allItems.length; i++) {
        if (shouldStop()) {
          onLog("采集已停止", "error");
          break;
        }

        const item = allItems[i];
        onLog(`正在采集详情 ${i + 1}/${allItems.length}: ${item.url}`, "");

        onLog(`正在打开详情页...`, "info");
        await chrome.tabs.update(tab.id, { url: item.url });

        const detailReady = await waitForGenericPageReady(
          tab.id,
          contentSelector,
          { maxRetries: 4, onLog: (msg, type) => onLog(msg, type) },
        );
        if (!detailReady) {
          onLog(`详情 ${i + 1} 页面加载失败，跳过`, "error");
          continue;
        }

        onLog(`模拟阅读行为...`, "info");
        await simulateHumanBehavior(tab.id, "read");

        // 注入 Turndown + 规则
        onLog(`正在提取内容...`, "info");
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["md/static/js/turndown.js", "src/utils/turndown-rules.js"],
        });

        let detail = null;
        for (let retry = 0; retry < 3; retry++) {
          const detailResults = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: collectDetailContent,
            args: [contentSelector],
          });
          detail = detailResults?.[0]?.result;
          if (detail) break;
          onLog(`提取失败，第 ${retry + 1} 次重试...`, "error");
          await exponentialBackoff(retry, 3000, 15000);
        }

        if (detail) {
          detailedItems.push({ ...item, ...detail });
          onLog(`详情 ${i + 1}/${allItems.length} 采集成功`, "success");
        } else {
          onLog(`详情 ${i + 1}/${allItems.length} 采集失败`, "error");
        }

        // 防检测延迟
        const progressRatio = i / allItems.length;
        const minDelay = 1000 + Math.floor(progressRatio * 1000);
        const maxDelay = 3000 + Math.floor(progressRatio * 2000);
        onLog(
          `等待 ${Math.round(minDelay / 1000)}-${Math.round(maxDelay / 1000)} 秒...`,
          "info",
        );
        await randomDelay(minDelay, maxDelay);

        // 周期性长休息
        const restInterval = 5 + Math.floor(Math.random() * 4);
        if ((i + 1) % restInterval === 0 && i + 1 < allItems.length) {
          const restTime = Math.floor(Math.random() * 15000) + 15000;
          onLog(`防风控休息 ${Math.round(restTime / 1000)} 秒...`, "info");
          await sleep(restTime);
          await simulateHumanBehavior(tab.id, "idle");
        }
      }
    } else {
      // 无 contentSelector：列表结果即为最终结果
      onLog(`无内容选择器，跳过详情采集`, "info");
      detailedItems.push(...allItems);
    }

    onLog(`采集完成，关闭标签页`, "info");
    try {
      await chrome.tabs.remove(tab.id);
    } catch {}
    return detailedItems;
  } catch (err) {
    onLog(`采集出错: ${err.message}`, "error");
    try {
      await chrome.tabs.remove(tab.id);
    } catch {}
    return [];
  }
}

/**
 * 将采集项格式化为 Markdown 片段
 */
export function postToMarkdown(post) {
  let md = "";
  if (post.markdown) {
    md += post.markdown + "\n";
  }
  md += `\n> [原文链接](${post.url})\n`;
  md += `\n---\n\n`;
  return md;
}
