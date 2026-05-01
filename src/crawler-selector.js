/**
 * 爬虫元素选择器
 * 注入到页面中，让用户可以选择要抓取的元素
 */

(function () {
  "use strict";

  // 如果已经存在选择器，先移除
  if (window.__crawlerSelector) {
    window.__crawlerSelector.destroy();
  }

  // 样式
  const style = document.createElement("style");
  style.id = "crawler-selector-style";
  style.textContent = `
    .crawler-selector-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 2147483646;
      pointer-events: none;
    }
    
    .crawler-selector-highlight {
      position: absolute;
      border: 2px solid #1890ff;
      background: rgba(24, 144, 255, 0.1);
      pointer-events: none;
      z-index: 2147483646;
      transition: all 0.1s ease;
    }

    .crawler-selector-highlight-label {
      position: absolute;
      top: -28px;
      left: 0;
      background: #1890ff;
      color: #fff;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 12px;
      white-space: nowrap;
      pointer-events: none;
      box-shadow: 0 2px 6px rgba(0,0,0,0.2);
      max-width: 400px;
      overflow: hidden;
      text-overflow: ellipsis;
      font-family: monospace;
      z-index: 2147483647;
    }
    
    .crawler-selector-tooltip {
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: #333;
      color: #fff;
      padding: 12px 24px;
      border-radius: 8px;
      font-size: 14px;
      z-index: 2147483647;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    }
    
    .crawler-selector-confirm {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: #fff;
      padding: 24px;
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.2);
      z-index: 2147483647;
      width: 600px;
      max-width: 90vw;
    }
    
    .crawler-selector-confirm h3 {
      margin: 0 0 16px 0;
      font-size: 16px;
      color: #333;
    }
    
    .crawler-selector-confirm p {
      margin: 0 0 8px 0;
      font-size: 13px;
      color: #666;
    }
    
    .crawler-selector-confirm .selector-text {
      font-family: monospace;
      background: #f5f5f5;
      padding: 8px 12px;
      border: 1px solid #ddd;
      border-radius: 4px;
      font-size: 12px;
      margin: 12px 0;
      width: 100%;
      min-height: 60px;
      resize: vertical;
      box-sizing: border-box;
      color: #333;
    }
    
    .crawler-selector-confirm .selector-text:focus {
      outline: none;
      border-color: #1890ff;
      background: #fff;
    }
    
    .crawler-selector-confirm .preview-text {
      background: #f9f9f9;
      padding: 12px;
      border-radius: 4px;
      font-size: 13px;
      max-height: 120px;
      overflow: auto;
      margin: 12px 0;
      color: #333;
      line-height: 1.5;
    }
    
    .crawler-selector-confirm .crawl-mode-group {
      margin: 12px 0;
    }

    .crawler-selector-confirm .crawl-mode-group label {
      display: inline-flex;
      align-items: center;
      margin-right: 16px;
      font-size: 13px;
      color: #333;
      cursor: pointer;
    }

    .crawler-selector-confirm .crawl-mode-group input[type="radio"] {
      margin-right: 4px;
      cursor: pointer;
    }

    .crawler-selector-confirm .crawl-mode-options {
      margin: 8px 0 0 0;
      padding: 12px;
      background: #f5f7fa;
      border-radius: 6px;
      border: 1px solid #e8e8e8;
    }

    .crawler-selector-confirm .crawl-mode-options .option-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }

    .crawler-selector-confirm .crawl-mode-options .option-row:last-child {
      margin-bottom: 0;
    }

    .crawler-selector-confirm .crawl-mode-options .option-label {
      font-size: 12px;
      color: #666;
      min-width: 70px;
    }

    .crawler-selector-confirm .crawl-mode-options input[type="number"] {
      width: 80px;
      padding: 4px 8px;
      border: 1px solid #ddd;
      border-radius: 4px;
      font-size: 12px;
      color: #333;
    }

    .crawler-selector-confirm .crawl-mode-options input[type="number"]:focus {
      outline: none;
      border-color: #1890ff;
    }

    .crawler-selector-confirm .crawl-mode-options .option-unit {
      font-size: 12px;
      color: #999;
    }

    .crawler-selector-confirm .pagination-selector-display {
      margin-top: 8px;
      padding: 8px 12px;
      background: #f5f5f5;
      border: 1px solid #ddd;
      border-radius: 4px;
      font-family: monospace;
      font-size: 12px;
      color: #333;
      min-height: 20px;
    }

    .crawler-selector-confirm .cs-btn-sm {
      padding: 4px 12px;
      border-radius: 4px;
      font-size: 12px;
      cursor: pointer;
      border: 1px solid #1890ff;
      background: #fff;
      color: #1890ff;
      transition: all 0.2s;
    }

    .crawler-selector-confirm .cs-btn-sm:hover {
      background: #1890ff;
      color: #fff;
    }

    .crawler-selector-confirm .buttons {
      display: flex;
      justify-content: flex-end;
      gap: 12px;
      margin-top: 16px;
    }
    
    .crawler-selector-confirm .cs-btn {
      padding: 8px 20px;
      border-radius: 6px;
      font-size: 14px;
      cursor: pointer;
      border: 1px solid transparent;
      transition: all 0.2s;
    }
    
    .crawler-selector-confirm .cs-btn-default {
      background: #f5f5f5;
      color: #666;
      border-color: #ddd;
    }
    
    .crawler-selector-confirm .cs-btn-default:hover {
      background: #e0e0e0;
    }
    
    .crawler-selector-confirm .cs-btn-secondary {
      background: #fff;
      color: #333;
      border: 1px solid #d9d9d9;
    }
    
    .crawler-selector-confirm .cs-btn-secondary:hover {
      border-color: #666;
      background: #fafafa;
    }
    
    .crawler-selector-confirm .cs-btn-primary {
      background: #1890ff;
      color: #fff;
    }
    
    .crawler-selector-confirm .cs-btn-primary:hover {
      background: #40a9ff;
    }
    
    .crawler-selector-mask {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0,0,0,0.5);
      z-index: 2147483646;
    }

    .crawler-selector-toast {
      position: fixed;
      top: 80px;
      left: 50%;
      transform: translateX(-50%);
      background: #ff4d4f;
      color: #fff;
      padding: 12px 24px;
      border-radius: 8px;
      font-size: 14px;
      z-index: 2147483647;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      animation: cs-toast-in 0.3s ease;
    }

    @keyframes cs-toast-in {
      from { opacity: 0; transform: translateX(-50%) translateY(-10px); }
      to { opacity: 1; transform: translateX(-50%) translateY(0); }
    }

    .crawler-selector-outline {
      outline: 3px dashed var(--cs-outline-color, #ccc) !important;
      outline-offset: -2px;
      background-color: var(--cs-bg-color, transparent) !important;
      box-shadow: inset 0 0 0 1px var(--cs-outline-color, #ccc) !important;
      transition: outline-color 0.2s, background-color 0.2s;
    }
  `;
  document.head.appendChild(style);

  // 彩色边框颜色方案（按嵌套深度循环分配）
  const outlineColors = [
    "#FF6B6B", // 红
    "#4ECDC4", // 青
    "#45B7D1", // 蓝
    "#96CEB4", // 绿
    "#FFEAA7", // 黄
    "#DDA0DD", // 紫
    "#FF8C42", // 橙
  ];

  const outlineContainerTags = new Set([
    "section", "article", "nav", "main", "aside",
    "header", "footer", "div", "ul", "ol", "table",
  ]);

  // 计算元素相对于 body 的容器嵌套深度
  function getContainerDepth(el) {
    let depth = 0;
    let current = el.parentElement;
    while (current && current !== document.body && current !== document.documentElement) {
      if (outlineContainerTags.has(current.tagName.toLowerCase())) {
        depth++;
      }
      current = current.parentElement;
    }
    return depth;
  }

  // 为页面元素添加彩色边框
  function addOutlines() {
    const selector = Array.from(outlineContainerTags).join(",");
    const elements = document.querySelectorAll(selector);
    elements.forEach((el) => {
      // 跳过不可见或太小的元素
      if (el.offsetHeight < 50 || el.children.length === 0) return;
      // 跳过我们自己注入的元素
      if (el.className && typeof el.className === "string" && el.className.includes("crawler-selector")) return;

      const depth = getContainerDepth(el);
      const color = outlineColors[depth % outlineColors.length];
      el.classList.add("crawler-selector-outline");
      el.style.setProperty("--cs-outline-color", color);
      el.style.setProperty("--cs-bg-color", color + "12");
    });
  }

  // 移除所有彩色边框
  function removeOutlines() {
    document.querySelectorAll(".crawler-selector-outline").forEach((el) => {
      el.classList.remove("crawler-selector-outline");
      el.style.removeProperty("--cs-outline-color");
      el.style.removeProperty("--cs-bg-color");
    });
  }

  // 显示 Toast 提示
  function showToast(message, duration = 2000) {
    // 移除已有的 toast
    document
      .querySelectorAll(".crawler-selector-toast")
      .forEach((el) => el.remove());
    const toast = document.createElement("div");
    toast.className = "crawler-selector-toast";
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), duration);
  }

  // 创建高亮元素
  const highlight = document.createElement("div");
  highlight.className = "crawler-selector-highlight";

  // 创建标签
  const label = document.createElement("div");
  label.className = "crawler-selector-highlight-label";
  highlight.appendChild(label);

  document.body.appendChild(highlight);

  // 创建提示
  const tooltip = document.createElement("div");
  tooltip.className = "crawler-selector-tooltip";
  tooltip.textContent = "请点击要抓取的内容区域，按 ESC 取消";
  document.body.appendChild(tooltip);

  let selectedElement = null;
  let isConfirmOpen = false;

  // 生成元素的 CSS 选择器
  function generateSelector(el) {
    if (el.id) {
      return `#${el.id}`;
    }

    const path = [];
    let current = el;

    while (current && current.nodeType === Node.ELEMENT_NODE) {
      let selector = current.tagName.toLowerCase();

      if (current.id) {
        selector = `#${current.id}`;
        path.unshift(selector);
        break;
      }

      if (current.className && typeof current.className === "string") {
        const classes = current.className
          .trim()
          .split(/\s+/)
          .filter((c) => c && !c.includes(":") && !c.startsWith("crawler-selector"));
        if (classes.length > 0) {
          selector += "." + classes.slice(0, 2).join(".");
        }
      }

      path.unshift(selector);

      // 判断当前选择器是否唯一
      const fullSelector = path.join(" > ");
      try {
        const matches = document.querySelectorAll(fullSelector);
        if (matches.length === 1 && matches[0] === el) {
          return fullSelector;
        }
      } catch (e) {
        // 忽略非法选择器错误
      }

      current = current.parentElement;

      // 限制深度，防止选择器过长
      if (path.length >= 5) break;
    }

    return path.join(" > ");
  }

  // 鼠标移动事件
  function onMouseMove(e) {
    if (isConfirmOpen) return;

    const el = e.target;
    // 确保不选中高亮框本身及其子元素
    if (!el || el === highlight || highlight.contains(el) || el === tooltip)
      return;

    const rect = el.getBoundingClientRect();
    highlight.style.left = rect.left + window.scrollX + "px";
    highlight.style.top = rect.top + window.scrollY + "px";
    highlight.style.width = rect.width + "px";
    highlight.style.height = rect.height + "px";
    highlight.style.display = "block";

    // 更新选择器显示的标签
    const selector = generateSelector(el);
    label.textContent = selector;

    // 如果元素太靠近顶部，将标签显示在下方，避免被遮挡
    if (rect.top <= 30) {
      label.style.top = "auto";
      label.style.bottom = "-28px";
    } else {
      label.style.top = "-28px";
      label.style.bottom = "auto";
    }
  }

  // 点击事件
  function onClick(e) {
    if (isConfirmOpen) return;

    e.preventDefault();
    e.stopPropagation();

    const el = e.target;
    if (!el || el === highlight || el === tooltip) return;

    selectedElement = el;

    if (window.__CRAWLER_AUTO_CONFIRM) {
      const selector = generateSelector(el);
      const content = el.textContent.trim();
      if (chrome?.runtime?.sendMessage) {
        chrome.runtime.sendMessage({
          type: "CRAWLER_SELECTOR_RESULT",
          data: {
            selector: selector,
            url: window.location.href,
            urlPattern: window.location.href,
            sampleContent: content,
          },
        });
      }
      destroy();
    } else {
      showConfirm(el);
    }
  }

  // 显示确认对话框
  function showConfirm(el) {
    isConfirmOpen = true;
    highlight.style.display = "none";
    tooltip.style.display = "none";

    const selector = generateSelector(el);
    const content = el.textContent.trim().substring(0, 200);

    const mask = document.createElement("div");
    mask.className = "crawler-selector-mask";

    const confirm = document.createElement("div");
    confirm.className = "crawler-selector-confirm";
    confirm.innerHTML = `
      <h3>确认选择</h3>
      <p>选择器：</p>
      <textarea class="selector-text">${selector}</textarea>
      <p>抓取模式：</p>
      <div class="crawl-mode-group">
        <label><input type="radio" name="cs-crawl-mode" value="static" checked> 仅抓取</label>
        <label><input type="radio" name="cs-crawl-mode" value="scroll"> 滚动</label>
        <label><input type="radio" name="cs-crawl-mode" value="pagination"> 分页</label>
      </div>
      <div class="crawl-mode-options" id="cs-scroll-options" style="display:none;">
        <div class="option-row">
          <span class="option-label">滚动次数：</span>
          <input type="number" id="cs-scroll-count" value="5" min="1" max="100">
          <span class="option-unit">次</span>
        </div>
        <div class="option-row">
          <span class="option-label">滚动距离：</span>
          <input type="number" id="cs-scroll-distance" value="800" min="100" max="10000" step="100">
          <span class="option-unit">px</span>
        </div>
      </div>
      <div class="crawl-mode-options" id="cs-pagination-options" style="display:none;">
        <div class="option-row">
          <span class="option-label">分页元素：</span>
          <button class="cs-btn-sm" id="cs-pick-pagination">选择分页元素</button>
        </div>
        <div class="pagination-selector-display" id="cs-pagination-display">(未选择)</div>
        <div class="option-row" style="margin-top:8px;">
          <span class="option-label">分页次数：</span>
          <input type="number" id="cs-pagination-count" value="5" min="1" max="100">
          <span class="option-unit">页</span>
        </div>
      </div>
      <div class="buttons">
        <button class="cs-btn cs-btn-default" id="cs-cancel">取消</button>
        <button class="cs-btn cs-btn-secondary" id="cs-reselect">重新选择</button>
        <button class="cs-btn cs-btn-primary" id="cs-confirm">确认保存</button>
      </div>
    `;

    document.body.appendChild(mask);
    document.body.appendChild(confirm);

    // 抓取模式切换逻辑
    let paginationSelector = "";
    const scrollOptions = confirm.querySelector("#cs-scroll-options");
    const paginationOptions = confirm.querySelector("#cs-pagination-options");
    const radios = confirm.querySelectorAll('input[name="cs-crawl-mode"]');

    radios.forEach((radio) => {
      radio.addEventListener("change", () => {
        scrollOptions.style.display = radio.value === "scroll" ? "block" : "none";
        paginationOptions.style.display = radio.value === "pagination" ? "block" : "none";
      });
    });

    // 分页元素选择
    confirm.querySelector("#cs-pick-pagination").onclick = () => {
      // 隐藏确认框，进入分页元素选择模式
      mask.style.display = "none";
      confirm.style.display = "none";
      tooltip.textContent = "请点击分页按钮（如「下一页」），按 ESC 返回";
      tooltip.style.display = "block";

      const paginationHighlight = document.createElement("div");
      paginationHighlight.className = "crawler-selector-highlight";
      const paginationLabel = document.createElement("div");
      paginationLabel.className = "crawler-selector-highlight-label";
      paginationHighlight.appendChild(paginationLabel);
      document.body.appendChild(paginationHighlight);

      function onPaginationMove(e) {
        const el = e.target;
        if (!el || el === paginationHighlight || paginationHighlight.contains(el) || el === tooltip) return;
        const rect = el.getBoundingClientRect();
        paginationHighlight.style.left = rect.left + window.scrollX + "px";
        paginationHighlight.style.top = rect.top + window.scrollY + "px";
        paginationHighlight.style.width = rect.width + "px";
        paginationHighlight.style.height = rect.height + "px";
        paginationHighlight.style.display = "block";
        paginationLabel.textContent = generateSelector(el);
        if (rect.top <= 30) {
          paginationLabel.style.top = "auto";
          paginationLabel.style.bottom = "-28px";
        } else {
          paginationLabel.style.top = "-28px";
          paginationLabel.style.bottom = "auto";
        }
      }

      function onPaginationClick(e) {
        e.preventDefault();
        e.stopPropagation();
        const el = e.target;
        if (!el || el === paginationHighlight || el === tooltip) return;
        paginationSelector = generateSelector(el);
        confirm.querySelector("#cs-pagination-display").textContent = paginationSelector;
        cleanupPaginationPick();
      }

      function onPaginationKey(e) {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          cleanupPaginationPick();
        }
      }

      function cleanupPaginationPick() {
        document.removeEventListener("mousemove", onPaginationMove, true);
        document.removeEventListener("click", onPaginationClick, true);
        document.removeEventListener("keydown", onPaginationKey, true);
        paginationHighlight.remove();
        tooltip.style.display = "none";
        mask.style.display = "block";
        confirm.style.display = "block";
      }

      document.addEventListener("mousemove", onPaginationMove, true);
      document.addEventListener("click", onPaginationClick, true);
      document.addEventListener("keydown", onPaginationKey, true);
    };

    // 聚焦到文本框方便编辑
    /* confirm.querySelector(".selector-text").focus(); // Optional: auto focus might be annoying if it scrolls */

    /* confirm.querySelector(".selector-text").focus(); // Optional: auto focus might be annoying if it scrolls */

    confirm.querySelector("#cs-cancel").onclick = () => {
      chrome.runtime.sendMessage({
        type: "CRAWLER_SELECTOR_CANCELLED",
      });
      destroy();
    };

    confirm.querySelector("#cs-reselect").onclick = () => {
      mask.remove();
      confirm.remove();
      isConfirmOpen = false;
      tooltip.style.display = "block";
    };

    confirm.querySelector("#cs-confirm").onclick = () => {
      // 获取用户可能修改过的选择器
      const finalSelector = confirm
        .querySelector(".selector-text")
        .value.trim();

      if (!finalSelector) {
        showToast("选择器不能为空");
        return;
      }

      // 获取抓取模式设置
      const crawlMode = confirm.querySelector('input[name="cs-crawl-mode"]:checked').value;
      const crawlModeSettings = { mode: crawlMode };

      if (crawlMode === "scroll") {
        crawlModeSettings.scrollCount = parseInt(confirm.querySelector("#cs-scroll-count").value) || 5;
        crawlModeSettings.scrollDistance = parseInt(confirm.querySelector("#cs-scroll-distance").value) || 800;
      } else if (crawlMode === "pagination") {
        if (!paginationSelector) {
          showToast("请先选择分页元素");
          return;
        }
        crawlModeSettings.paginationSelector = paginationSelector;
        crawlModeSettings.paginationCount = parseInt(confirm.querySelector("#cs-pagination-count").value) || 10;
      }

      // 检测选择器下是否存在链接（或自身就是链接）
      try {
        const container = document.querySelector(finalSelector);
        if (container) {
          const isLink = container.matches("a[href]");
          const hasLinks = container.querySelectorAll("a[href]").length > 0;
          if (!isLink && !hasLinks) {
            showToast("该选择器下没有抓取到链接，请重新选择");
            return;
          }
        }
      } catch (e) {
        // 选择器语法错误，让后端处理
      }

      // 发送消息给扩展
      chrome.runtime.sendMessage({
        type: "CRAWLER_SELECTOR_RESULT",
        data: {
          selector: finalSelector,
          url: window.location.href,
          urlPattern: window.location.href,
          sampleContent: content,
          crawlMode: crawlModeSettings,
        },
      });

      destroy();
    };
  }

  // ESC 键取消
  function onKeyDown(e) {
    if (e.key === "Escape") {
      if (chrome?.runtime?.sendMessage) {
        chrome.runtime.sendMessage({
          type: "CRAWLER_SELECTOR_CANCELLED",
        });
      }
      destroy();
    }
  }

  // 销毁选择器
  function destroy() {
    document.removeEventListener("mousemove", onMouseMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKeyDown, true);

    removeOutlines();

    highlight?.remove();
    tooltip?.remove();
    style?.remove();

    document
      .querySelectorAll(".crawler-selector-mask, .crawler-selector-confirm")
      .forEach((el) => el.remove());

    delete window.__crawlerSelector;
  }

  // 绑定事件
  document.addEventListener("mousemove", onMouseMove, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKeyDown, true);

  // 为页面容器元素添加彩色边框，方便识别区块
  addOutlines();

  // 暴露销毁方法
  window.__crawlerSelector = { destroy };
})();
