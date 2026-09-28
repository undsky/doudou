/**
 * 豆豆 - 页面元素选取并下载为 Markdown 模块
 */

(function () {
  // 如果已存在正在运行的选取器实例，先清理
  if (window.__doudouElementPickerCleanup) {
    window.__doudouElementPickerCleanup();
  }

  const STYLE_ID = "doudou-element-picker-style";
  const BANNER_ID = "doudou-element-picker-banner";
  const HIGHLIGHT_ID = "doudou-element-picker-highlight";
  const TOAST_ID = "doudou-element-picker-toast";

  let currentTarget = null;
  let isPicking = true;

  // 注入样式
  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${BANNER_ID} {
        position: fixed !important;
        top: 20px !important;
        left: 50% !important;
        transform: translateX(-50%) !important;
        z-index: 2147483647 !important;
        display: flex !important;
        align-items: center !important;
        gap: 12px !important;
        background: rgba(17, 24, 39, 0.9) !important;
        backdrop-filter: blur(8px) !important;
        -webkit-backdrop-filter: blur(8px) !important;
        color: #ffffff !important;
        padding: 10px 18px !important;
        border-radius: 30px !important;
        box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3), 0 8px 10px -6px rgba(0, 0, 0, 0.2), 0 0 0 1px rgba(255, 255, 255, 0.1) !important;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif !important;
        font-size: 13px !important;
        line-height: 1.5 !important;
        pointer-events: auto !important;
        user-select: none !important;
        animation: doudou-banner-slide-down 0.25s cubic-bezier(0.16, 1, 0.3, 1) !important;
      }

      @keyframes doudou-banner-slide-down {
        from {
          opacity: 0;
          transform: translate(-50%, -20px);
        }
        to {
          opacity: 1;
          transform: translate(-50%, 0);
        }
      }

      #${BANNER_ID} .doudou-banner-icon {
        font-size: 16px !important;
        display: flex !important;
        align-items: center !important;
      }

      #${BANNER_ID} .doudou-banner-text {
        font-weight: 500 !important;
        color: #f3f4f6 !important;
      }

      #${BANNER_ID} .doudou-banner-shortcut {
        color: #9ca3af !important;
        font-size: 12px !important;
        margin-left: 4px !important;
      }

      #${BANNER_ID} .doudou-banner-cancel-btn {
        background: rgba(255, 255, 255, 0.15) !important;
        border: none !important;
        color: #ffffff !important;
        padding: 4px 10px !important;
        border-radius: 14px !important;
        font-size: 12px !important;
        cursor: pointer !important;
        transition: all 0.2s ease !important;
        outline: none !important;
      }

      #${BANNER_ID} .doudou-banner-cancel-btn:hover {
        background: rgba(239, 68, 68, 0.8) !important;
      }

      #${HIGHLIGHT_ID} {
        position: fixed !important;
        pointer-events: none !important;
        z-index: 2147483646 !important;
        background: rgba(59, 130, 246, 0.18) !important;
        border: 2px solid #2563eb !important;
        border-radius: 4px !important;
        box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.5), inset 0 0 12px rgba(37, 99, 235, 0.15) !important;
        transition: top 0.08s ease-out, left 0.08s ease-out, width 0.08s ease-out, height 0.08s ease-out !important;
        display: none;
        box-sizing: border-box !important;
      }

      #${HIGHLIGHT_ID} .doudou-highlight-tag {
        position: absolute !important;
        left: 0 !important;
        bottom: 100% !important;
        transform: translateY(-4px) !important;
        background: #2563eb !important;
        color: #ffffff !important;
        font-size: 11px !important;
        font-family: monospace, -apple-system, sans-serif !important;
        padding: 2px 6px !important;
        border-radius: 4px !important;
        white-space: nowrap !important;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2) !important;
        display: flex !important;
        align-items: center !important;
        gap: 4px !important;
      }

      #${HIGHLIGHT_ID} .doudou-highlight-tag.bottom {
        bottom: auto !important;
        top: 100% !important;
        transform: translateY(4px) !important;
      }

      #${TOAST_ID} {
        position: fixed !important;
        bottom: 30px !important;
        left: 50% !important;
        transform: translateX(-50%) !important;
        z-index: 2147483647 !important;
        background: rgba(17, 24, 39, 0.9) !important;
        backdrop-filter: blur(8px) !important;
        -webkit-backdrop-filter: blur(8px) !important;
        color: #ffffff !important;
        padding: 10px 20px !important;
        border-radius: 8px !important;
        font-size: 14px !important;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
        box-shadow: 0 10px 20px rgba(0, 0, 0, 0.2) !important;
        pointer-events: none !important;
        transition: opacity 0.3s ease, transform 0.3s ease !important;
        opacity: 0;
        transform: translate(-50%, 10px) !important;
      }

      #${TOAST_ID}.show {
        opacity: 1 !important;
        transform: translate(-50%, 0) !important;
      }
    `;
    document.head.appendChild(style);
  }

  // 显示 Toast 提示
  function showToast(message, duration = 2500) {
    let toast = document.getElementById(TOAST_ID);
    if (!toast) {
      toast = document.createElement("div");
      toast.id = TOAST_ID;
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    // 触发重绘以运行 CSS transition
    void toast.offsetHeight;
    toast.classList.add("show");

    setTimeout(() => {
      toast.classList.remove("show");
      setTimeout(() => {
        toast?.remove();
      }, 350);
    }, duration);
  }

  // 创建 UI 元素
  let bannerEl = null;
  let highlightEl = null;
  let tagEl = null;

  function createUI() {
    injectStyles();

    // 顶部提示 Banner
    bannerEl = document.createElement("div");
    bannerEl.id = BANNER_ID;
    bannerEl.innerHTML = `
      <span class="doudou-banner-icon">🎯</span>
      <span class="doudou-banner-text">正在选取元素：移动鼠标高亮目标，点击下载为 Markdown</span>
      <span class="doudou-banner-shortcut">(按 ESC 键取消)</span>
      <button class="doudou-banner-cancel-btn" type="button">取消</button>
    `;
    bannerEl.querySelector(".doudou-banner-cancel-btn").addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      cleanup();
    });
    document.body.appendChild(bannerEl);

    // 高亮框
    highlightEl = document.createElement("div");
    highlightEl.id = HIGHLIGHT_ID;
    tagEl = document.createElement("div");
    tagEl.className = "doudou-highlight-tag";
    highlightEl.appendChild(tagEl);
    document.body.appendChild(highlightEl);
  }

  // 判断是否为插件或选取器自身的 DOM
  function isInternalElement(el) {
    if (!el || el === document.body || el === document.documentElement) return true;
    if (el.closest(`#${BANNER_ID}, #${HIGHLIGHT_ID}, #${TOAST_ID}`)) return true;
    if (el.closest("#doudou-floating-btn, #doudou-selection-bar, #doudou-translate-toast")) return true;
    if (el.id && el.id.startsWith("doudou-")) return true;
    return false;
  }

  // 更新高亮框位置
  function updateHighlight(el) {
    if (!el || isInternalElement(el)) {
      highlightEl.style.display = "none";
      currentTarget = null;
      return;
    }

    currentTarget = el;
    const rect = el.getBoundingClientRect();

    highlightEl.style.display = "block";
    highlightEl.style.top = `${rect.top}px`;
    highlightEl.style.left = `${rect.left}px`;
    highlightEl.style.width = `${rect.width}px`;
    highlightEl.style.height = `${rect.height}px`;

    // 构造标签文本，例如: div.main#content (800×600)
    let tagText = el.tagName.toLowerCase();
    if (el.id) {
      tagText += `#${el.id}`;
    } else if (el.className && typeof el.className === "string") {
      const classes = el.className
        .trim()
        .split(/\s+/)
        .filter((c) => c && !c.startsWith("doudou-"))
        .slice(0, 2);
      if (classes.length > 0) {
        tagText += `.${classes.join(".")}`;
      }
    }
    tagText += ` (${Math.round(rect.width)} × ${Math.round(rect.height)})`;
    tagEl.textContent = tagText;

    // 如果元素太靠顶部，把标签移到下方
    if (rect.top < 35) {
      tagEl.classList.add("bottom");
    } else {
      tagEl.classList.remove("bottom");
    }
  }

  // 鼠标移动监听
  function handleMouseMove(e) {
    if (!isPicking) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    updateHighlight(el);
  }

  // 键盘 ESC 退出监听
  function handleKeyDown(e) {
    if (e.key === "Escape" || e.keyCode === 27) {
      e.preventDefault();
      cleanup();
    }
  }

  // 鼠标点击捕获监听
  function handleClick(e) {
    if (!isPicking) return;

    // 检查是否点击了取消按钮或 banner 内部
    if (e.target.closest(`#${BANNER_ID}`)) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    const selectedTarget = currentTarget || document.elementFromPoint(e.clientX, e.clientY);

    // 清理拾取模式
    cleanup();

    if (selectedTarget && !isInternalElement(selectedTarget)) {
      processAndDownloadMarkdown(selectedTarget);
    }
  }

  // 清洗并转换选中的元素为 Markdown
  function processAndDownloadMarkdown(targetElement) {
    try {
      showToast("正在生成 Markdown...", 1500);

      // 克隆目标节点
      const clone = targetElement.cloneNode(true);

      // 移除噪音和插件 DOM
      const noiseTags = ["SCRIPT", "STYLE", "NOSCRIPT", "IFRAME", "OBJECT", "EMBED"];
      noiseTags.forEach((tag) => {
        clone.querySelectorAll(tag).forEach((el) => el.remove());
      });

      clone
        .querySelectorAll("[id^='doudou-'], [data-doudou-translate]")
        .forEach((el) => el.remove());

      // 补全相对路径链接与图片地址
      const origin = window.location.origin;
      const baseURI = window.location.href;

      clone.querySelectorAll("a").forEach((a) => {
        const href = a.getAttribute("href");
        if (href && !href.startsWith("javascript:") && !href.startsWith("#")) {
          try {
            a.setAttribute("href", new URL(href, baseURI).href);
          } catch {}
        }
      });

      clone.querySelectorAll("img").forEach((img) => {
        // 尝试获取各种懒加载真实图片属性
        const src =
          img.getAttribute("data-src") ||
          img.getAttribute("data-original-src") ||
          img.getAttribute("data-original") ||
          img.getAttribute("data-actualsrc") ||
          img.getAttribute("src");

        if (src) {
          try {
            img.setAttribute("src", new URL(src, baseURI).href);
          } catch {}
        }
      });

      // 初始化 TurndownService
      if (typeof TurndownService === "undefined") {
        throw new Error("TurndownService 未加载");
      }

      const turndownService = new TurndownService({
        headingStyle: "atx",
        hr: "---",
        bulletListMarker: "-",
        codeBlockStyle: "fenced",
        emDelimiter: "*",
      });

      // 载入增强规则（表格、链接等）
      if (typeof addTurndownRules === "function") {
        addTurndownRules(turndownService);
      }

      let markdown = turndownService.turndown(clone.innerHTML || clone.outerHTML);

      // 格式化处理：修剪头尾，压缩连续 3 个以上的空行
      markdown = markdown.replace(/(\s*\n\s*){3,}/g, "\n\n").trim();

      if (!markdown) {
        showToast("选取的元素内容为空", 2500);
        return;
      }

      // 在导出内容开头添加页面链接
      const pageUrl = window.location.href;
      if (pageUrl) {
        markdown = `[${pageUrl}](${pageUrl})\n\n${markdown}`;
      }

      // 构造文件名：[页面标题]_[时间戳].md
      const rawTitle = (document.title || "element").trim();
      let sanitizedTitle = rawTitle
        .replace(/[\\/:*?"<>|\r\n\t]/g, "_")
        .replace(/\s+/g, " ")
        .replace(/_+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 100)
        .trim();
      if (!sanitizedTitle) sanitizedTitle = "element";

      const now = new Date();
      const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
      const filename = `${sanitizedTitle}_${dateStr}.md`;

      // 触发下载
      const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
      const downloadUrl = URL.createObjectURL(blob);
      const downloadLink = document.createElement("a");
      downloadLink.style.display = "none";
      downloadLink.href = downloadUrl;
      downloadLink.download = filename;
      document.body.appendChild(downloadLink);
      downloadLink.click();

      setTimeout(() => {
        downloadLink.remove();
        URL.revokeObjectURL(downloadUrl);
      }, 100);

      showToast(`已成功下载 Markdown：${filename}`, 3000);
    } catch (err) {
      console.error("[豆豆] 转换 Markdown 失败:", err);
      showToast(`导出失败: ${err.message || err}`, 3000);
    }
  }

  // 清理函数
  function cleanup() {
    isPicking = false;
    window.removeEventListener("mousemove", handleMouseMove, true);
    window.removeEventListener("keydown", handleKeyDown, true);
    window.removeEventListener("click", handleClick, true);

    if (bannerEl) {
      bannerEl.remove();
      bannerEl = null;
    }
    if (highlightEl) {
      highlightEl.remove();
      highlightEl = null;
      tagEl = null;
    }
    const styleEl = document.getElementById(STYLE_ID);
    if (styleEl) {
      styleEl.remove();
    }

    window.__doudouElementPickerCleanup = null;
  }

  // 绑定退出回调供下次重新注入时调用
  window.__doudouElementPickerCleanup = cleanup;

  // 启动
  createUI();
  window.addEventListener("mousemove", handleMouseMove, true);
  window.addEventListener("keydown", handleKeyDown, true);
  window.addEventListener("click", handleClick, true);
})();
