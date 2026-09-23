/**
 * 豆豆 - XML 排版与可读性增强模块
 * 采用全屏隔离容器技术，完美支持 XMLDocument 与 Chromium XML Viewer
 * 支持交互式 XML 树形语法高亮、节点折叠、搜索过滤、格式化复制/下载
 * 支持 RSS 2.0 / Atom 订阅源智能图文阅读模式
 */

(async function () {
  const FRAME_ID = "doudou-xml-formatter-frame";

  // 1. 如果已存在，直接激活显示
  const existingFrame = document.getElementById(FRAME_ID);
  if (existingFrame) {
    existingFrame.style.display = "block";
    return { success: true, message: "已激活 XML 排版视图" };
  }

  // 2. 检测当前页面是否为 XML
  function isXmlDocument() {
    const ct = (document.contentType || "").toLowerCase();
    if (ct.includes("xml") || ct.includes("+xml")) return true;
    if (document instanceof XMLDocument) return true;
    if (document.getElementById("webkit-xml-viewer-source-xml")) return true;

    const rootName = document.documentElement
      ? document.documentElement.nodeName.toLowerCase()
      : "";
    if (rootName && rootName !== "html") return true;

    const bodyText = (document.body ? document.body.innerText : "").trim();
    if (
      bodyText.startsWith("<?xml") ||
      bodyText.startsWith("<rss") ||
      bodyText.startsWith("<feed")
    ) {
      try {
        const parsed = new DOMParser().parseFromString(
          bodyText,
          "application/xml"
        );
        if (!parsed.querySelector("parsererror")) return true;
      } catch (_) {}
    }

    return false;
  }

  if (!isXmlDocument()) {
    return {
      success: false,
      isXml: false,
      error: "当前页面不是 XML 内容",
    };
  }

  // 3. 获取原始 XML 文本
  async function fetchRawXml() {
    try {
      const res = await fetch(window.location.href, { credentials: "include" });
      if (res.ok) {
        const text = await res.text();
        if (
          text &&
          (text.includes("<?xml") ||
            (text.includes("<") && text.includes(">")))
        ) {
          return text;
        }
      }
    } catch (e) {
      console.warn("[豆豆] fetch 当前页面失败，采用 DOM 解析:", e);
    }

    // Chromium 内置 XML Viewer 备份容器
    const sourceDiv = document.getElementById("webkit-xml-viewer-source-xml");
    if (sourceDiv && sourceDiv.firstElementChild) {
      return (
        '<?xml version="1.0" encoding="UTF-8"?>\n' +
        new XMLSerializer().serializeToString(sourceDiv.firstElementChild)
      );
    }

    // 非 HTML 根节点
    if (
      document.documentElement &&
      document.documentElement.nodeName.toLowerCase() !== "html"
    ) {
      return (
        '<?xml version="1.0" encoding="UTF-8"?>\n' +
        new XMLSerializer().serializeToString(document.documentElement)
      );
    }

    // body 纯文本
    const bodyText = document.body ? document.body.innerText.trim() : "";
    if (bodyText.startsWith("<?xml") || bodyText.startsWith("<")) {
      return bodyText;
    }

    return new XMLSerializer().serializeToString(document);
  }

  const rawXml = await fetchRawXml();
  if (!rawXml) {
    return { success: false, error: "无法读取 XML 文本内容" };
  }

  // 4. 解析 XML DOM
  let xmlDoc = null;
  try {
    const parser = new DOMParser();
    xmlDoc = parser.parseFromString(rawXml, "application/xml");
  } catch (e) {
    console.error("[豆豆] XML 解析错误:", e);
  }

  // 5. 解析 RSS 2.0 / Atom 订阅源数据
  function parseFeedData(doc) {
    if (!doc || !doc.documentElement) return null;
    const root = doc.documentElement;
    const rootTag = root.nodeName.toLowerCase();

    const channel = doc.querySelector("channel");
    if (rootTag === "rss" || channel) {
      const getVal = (parent, sel) => {
        const el = parent ? parent.querySelector(sel) : null;
        return el ? el.textContent.trim() : "";
      };

      const title = getVal(channel, "title") || "RSS 订阅源";
      const link = getVal(channel, "link") || window.location.href;
      const description = getVal(channel, "description") || "";
      const lastBuildDate =
        getVal(channel, "lastBuildDate") ||
        getVal(channel, "pubDate") ||
        "";
      const generator = getVal(channel, "generator") || "";
      const imageUrl =
        channel?.querySelector("image > url")?.textContent?.trim() || "";

      const itemEls = Array.from(doc.querySelectorAll("item"));
      const items = itemEls.map((item) => {
        const itemTitle = getVal(item, "title") || "无标题";
        const itemLink = getVal(item, "link") || "";
        const itemPubDate =
          getVal(item, "pubDate") || getVal(item, "date") || "";
        const itemAuthor =
          getVal(item, "author") ||
          getVal(item, "dc\\:creator") ||
          getVal(item, "creator") ||
          "";
        const contentEncoded = item.getElementsByTagNameNS(
          "*",
          "encoded"
        )[0]?.textContent;
        const itemDesc = contentEncoded || getVal(item, "description") || "";
        const categories = Array.from(item.querySelectorAll("category"))
          .map((c) => c.textContent.trim())
          .filter(Boolean);

        return {
          title: itemTitle,
          link: itemLink,
          pubDate: itemPubDate,
          author: itemAuthor,
          content: itemDesc,
          categories,
        };
      });

      return {
        type: "rss",
        title,
        link,
        description,
        lastBuildDate,
        generator,
        imageUrl,
        items,
      };
    }

    if (rootTag === "feed") {
      const getVal = (parent, sel) => {
        const el = parent ? parent.querySelector(sel) : null;
        return el ? el.textContent.trim() : "";
      };

      const title = getVal(root, "title") || "Atom 订阅源";
      const linkEl =
        root.querySelector('link[rel="alternate"]') ||
        root.querySelector("link");
      const link = linkEl
        ? linkEl.getAttribute("href") || linkEl.textContent.trim()
        : window.location.href;
      const description = getVal(root, "subtitle") || "";
      const lastBuildDate = getVal(root, "updated") || "";
      const generator = getVal(root, "generator") || "";
      const imageUrl = getVal(root, "logo") || getVal(root, "icon") || "";

      const entryEls = Array.from(root.querySelectorAll("entry"));
      const items = entryEls.map((entry) => {
        const itemTitle = getVal(entry, "title") || "无标题";
        const itemLinkEl =
          entry.querySelector('link[rel="alternate"]') ||
          entry.querySelector("link");
        const itemLink = itemLinkEl
          ? itemLinkEl.getAttribute("href") || itemLinkEl.textContent.trim()
          : "";
        const itemPubDate =
          getVal(entry, "updated") || getVal(entry, "published") || "";
        const itemAuthor =
          getVal(entry, "author > name") || getVal(entry, "author") || "";
        const itemContent =
          getVal(entry, "content") || getVal(entry, "summary") || "";
        const categories = Array.from(entry.querySelectorAll("category"))
          .map((c) => c.getAttribute("term") || c.textContent.trim())
          .filter(Boolean);

        return {
          title: itemTitle,
          link: itemLink,
          pubDate: itemPubDate,
          author: itemAuthor,
          content: itemContent,
          categories,
        };
      });

      return {
        type: "atom",
        title,
        link,
        description,
        lastBuildDate,
        generator,
        imageUrl,
        items,
      };
    }

    return null;
  }

  const feedData = parseFeedData(xmlDoc);
  const hasFeed = !!feedData;

  // 6. 创建标准 HTML5 容器（跨越 XML 文档的严格解析限制）
  const iframe = document.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "iframe"
  );
  iframe.id = FRAME_ID;
  iframe.style.cssText =
    "position:fixed;top:0;left:0;width:100vw;height:100vh;border:none;z-index:2147483647;background:#0b1120;color-scheme:dark;";

  const targetParent = document.body || document.documentElement;
  targetParent.appendChild(iframe);

  const doc = iframe.contentDocument;
  doc.open();
  doc.write(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>豆豆 XML 排版助手</title>
  <style>
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    }
    #app {
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
    }

    /* 暗色主题 */
    .theme-dark {
      background-color: #0b1120;
      color: #e2e8f0;
    }
    .theme-dark .header {
      background: rgba(15, 23, 42, 0.88);
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    }
    .theme-dark .channel-card,
    .theme-dark .feed-item-card {
      background: #1e293b;
      border: 1px solid rgba(255, 255, 255, 0.07);
      box-shadow: 0 4px 20px -2px rgba(0, 0, 0, 0.3);
    }
    .theme-dark .xml-code-container {
      background: #0f172a;
      color: #cbd5e1;
    }
    .theme-dark .xml-tag-name { color: #38bdf8; font-weight: 600; }
    .theme-dark .xml-attr-name { color: #fbbf24; }
    .theme-dark .xml-attr-val { color: #34d399; }
    .theme-dark .xml-tag { color: #94a3b8; }
    .theme-dark .xml-comment { color: #64748b; font-style: italic; }
    .theme-dark .xml-cdata { color: #f472b6; }
    .theme-dark .xml-cdata-content { color: #fbcfe8; }
    .theme-dark .xml-text { color: #f1f5f9; }
    .theme-dark .search-box {
      background: rgba(30, 41, 59, 0.7);
      border: 1px solid rgba(255, 255, 255, 0.12);
    }
    .theme-dark .search-box input {
      color: #f8fafc;
    }

    /* 亮色主题 */
    .theme-light {
      background-color: #f8fafc;
      color: #1e293b;
    }
    .theme-light .header {
      background: rgba(255, 255, 255, 0.9);
      border-bottom: 1px solid #e2e8f0;
      box-shadow: 0 1px 3px rgba(0,0,0,0.05);
    }
    .theme-light .channel-card,
    .theme-light .feed-item-card {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      box-shadow: 0 4px 16px -2px rgba(0, 0, 0, 0.05);
    }
    .theme-light .xml-code-container {
      background: #ffffff;
      color: #334155;
      border: 1px solid #e2e8f0;
    }
    .theme-light .xml-tag-name { color: #0284c7; font-weight: 600; }
    .theme-light .xml-attr-name { color: #d97706; }
    .theme-light .xml-attr-val { color: #059669; }
    .theme-light .xml-tag { color: #64748b; }
    .theme-light .xml-comment { color: #94a3b8; font-style: italic; }
    .theme-light .xml-cdata { color: #db2777; }
    .theme-light .xml-cdata-content { color: #9d174d; }
    .theme-light .xml-text { color: #0f172a; }
    .theme-light .search-box {
      background: #f1f5f9;
      border: 1px solid #cbd5e1;
    }
    .theme-light .search-box input {
      color: #0f172a;
    }

    /* 顶部导航 Header */
    .header {
      height: 60px;
      min-height: 60px;
      padding: 0 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      backdrop-filter: blur(16px);
      gap: 16px;
    }
    .header-left {
      display: flex;
      align-items: center;
      gap: 16px;
    }
    .brand-logo {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 600;
      font-size: 15px;
    }
    .brand-icon {
      font-size: 20px;
    }
    .view-tabs {
      display: flex;
      background: rgba(0, 0, 0, 0.15);
      padding: 3px;
      border-radius: 8px;
      gap: 2px;
    }
    .tab-btn {
      background: transparent;
      border: none;
      padding: 6px 14px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 500;
      color: inherit;
      opacity: 0.7;
      cursor: pointer;
      transition: all 0.2s ease;
    }
    .tab-btn:hover {
      opacity: 1;
    }
    .tab-btn.active {
      background: #3b82f6;
      color: #ffffff;
      opacity: 1;
      box-shadow: 0 2px 8px rgba(59, 130, 246, 0.4);
    }
    .badge-tag {
      font-size: 12px;
      padding: 3px 8px;
      border-radius: 6px;
      background: rgba(59, 130, 246, 0.15);
      color: #38bdf8;
      font-weight: 500;
    }

    .header-center {
      flex: 1;
      max-width: 440px;
    }
    .search-box {
      display: flex;
      align-items: center;
      padding: 6px 12px;
      border-radius: 8px;
      gap: 8px;
      transition: all 0.2s;
    }
    .search-box:focus-within {
      border-color: #3b82f6 !important;
      box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
    }
    .search-icon {
      font-size: 14px;
      opacity: 0.6;
    }
    .search-box input {
      border: none;
      background: transparent;
      outline: none;
      width: 100%;
      font-size: 13px;
    }
    .search-count {
      font-size: 11px;
      opacity: 0.75;
      white-space: nowrap;
    }

    .header-right {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .action-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 500;
      border: 1px solid rgba(255, 255, 255, 0.1);
      background: rgba(255, 255, 255, 0.05);
      color: inherit;
      cursor: pointer;
      transition: all 0.2s ease;
    }
    .theme-light .action-btn {
      border: 1px solid #e2e8f0;
      background: #f8fafc;
    }
    .action-btn:hover {
      background: rgba(59, 130, 246, 0.15);
      border-color: #3b82f6;
      color: #38bdf8;
    }
    .action-btn.icon-only {
      padding: 6px 10px;
      font-size: 15px;
    }
    .action-btn.exit-btn {
      background: rgba(239, 68, 68, 0.12);
      color: #f87171;
      border-color: rgba(239, 68, 68, 0.25);
    }
    .action-btn.exit-btn:hover {
      background: #ef4444;
      color: #ffffff;
    }

    /* 主内容区 */
    .content {
      flex: 1;
      overflow-y: auto;
      position: relative;
    }

    /* 1. RSS 阅读器视图 */
    .reader-view {
      padding: 30px 20px 80px;
    }
    .reader-view.hidden,
    .code-view.hidden {
      display: none !important;
    }
    .reader-container {
      max-width: 860px;
      margin: 0 auto;
    }
    .channel-card {
      padding: 24px;
      border-radius: 16px;
      margin-bottom: 24px;
    }
    .channel-header {
      display: flex;
      gap: 20px;
      align-items: flex-start;
    }
    .channel-avatar {
      width: 64px;
      height: 64px;
      border-radius: 12px;
      object-fit: cover;
      background: #334155;
    }
    .channel-avatar.placeholder {
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 32px;
    }
    .channel-meta {
      flex: 1;
    }
    .channel-title {
      margin: 0 0 8px 0;
      font-size: 22px;
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .channel-title a {
      color: inherit;
      text-decoration: none;
    }
    .channel-title a:hover {
      color: #38bdf8;
    }
    .channel-badge {
      font-size: 11px;
      padding: 2px 7px;
      border-radius: 4px;
      background: #3b82f6;
      color: #fff;
      font-weight: 600;
    }
    .channel-desc {
      margin: 0 0 12px 0;
      font-size: 14px;
      opacity: 0.8;
      line-height: 1.6;
    }
    .channel-subinfo {
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
      font-size: 12px;
      opacity: 0.65;
    }

    .feed-items-list {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }
    .feed-item-card {
      border-radius: 16px;
      padding: 24px;
      transition: transform 0.2s ease, box-shadow 0.2s ease;
    }
    .feed-item-card:hover {
      transform: translateY(-2px);
    }
    .item-header {
      margin-bottom: 16px;
    }
    .item-title {
      margin: 0 0 10px 0;
      font-size: 19px;
      font-weight: 600;
      line-height: 1.4;
    }
    .item-title a {
      color: inherit;
      text-decoration: none;
      transition: color 0.2s;
    }
    .item-title a:hover {
      color: #38bdf8;
    }
    .item-meta {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 12px;
      font-size: 13px;
      opacity: 0.7;
    }
    .meta-tag {
      background: rgba(59, 130, 246, 0.12);
      color: #38bdf8;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 11px;
    }
    .item-body {
      font-size: 15px;
      line-height: 1.75;
      overflow-wrap: break-word;
      word-break: break-word;
    }
    .item-body p {
      margin: 0.8em 0;
    }
    .item-body img {
      max-width: 100%;
      height: auto;
      border-radius: 10px;
      display: block;
      margin: 14px 0;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    }
    .item-body blockquote {
      border-left: 4px solid #3b82f6;
      margin: 1em 0;
      padding: 8px 16px;
      background: rgba(59, 130, 246, 0.06);
      border-radius: 0 8px 8px 0;
      font-style: normal;
    }
    .item-body a {
      color: #38bdf8;
      text-decoration: none;
    }
    .item-body a:hover {
      text-decoration: underline;
    }
    .item-footer {
      margin-top: 18px;
      padding-top: 14px;
      border-top: 1px solid rgba(255, 255, 255, 0.06);
      display: flex;
      justify-content: flex-end;
    }
    .theme-light .item-footer {
      border-top-color: #f1f5f9;
    }
    .item-link-btn {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 13px;
      color: #38bdf8;
      text-decoration: none;
      font-weight: 500;
    }
    .item-link-btn:hover {
      text-decoration: underline;
    }

    /* 2. XML 代码树视图 */
    .code-view {
      padding: 20px 24px 60px;
      min-height: 100%;
    }
    .xml-code-container {
      border-radius: 12px;
      padding: 20px;
      font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
      font-size: 13px;
      line-height: 1.6;
      tab-size: 2;
      overflow-x: auto;
    }
    .xml-node-line {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      min-height: 22px;
      position: relative;
    }
    .xml-fold-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 14px;
      height: 14px;
      margin-left: -16px;
      margin-right: 2px;
      cursor: pointer;
      font-size: 11px;
      opacity: 0.6;
      user-select: none;
      transition: transform 0.15s ease;
    }
    .xml-fold-btn:hover {
      opacity: 1;
      color: #38bdf8;
    }
    .xml-fold-placeholder {
      display: inline-block;
      width: 14px;
      margin-left: -16px;
      margin-right: 2px;
    }
    .xml-collapsed-ellipsis {
      background: rgba(255, 255, 255, 0.1);
      padding: 0 5px;
      border-radius: 3px;
      margin: 0 4px;
      cursor: pointer;
      font-size: 12px;
    }
    .theme-light .xml-collapsed-ellipsis {
      background: #e2e8f0;
    }
    .xml-highlight {
      background: #eab308;
      color: #000;
      padding: 0 2px;
      border-radius: 2px;
    }
    .fallback-pre {
      margin: 0;
      white-space: pre-wrap;
      word-break: break-all;
    }

    .toast {
      position: fixed;
      bottom: 30px;
      left: 50%;
      transform: translateX(-50%) translateY(20px);
      background: rgba(15, 23, 42, 0.95);
      color: #f8fafc;
      border: 1px solid rgba(255, 255, 255, 0.15);
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.4);
      padding: 10px 20px;
      border-radius: 10px;
      font-size: 14px;
      font-weight: 500;
      opacity: 0;
      pointer-events: none;
      transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
      z-index: 2147483647;
    }
    .toast.show {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
  </style>
</head>
<body class="theme-dark">
  <div id="app">
    <header class="header">
      <div class="header-left">
        <div class="brand-logo">
          <span class="brand-icon">🏷️</span>
          <span class="brand-title">豆豆 XML 排版</span>
        </div>
        ${
          hasFeed
            ? `
        <div class="view-tabs">
          <button class="tab-btn active" id="tab-reader">📰 订阅阅读 (${feedData.items.length})</button>
          <button class="tab-btn" id="tab-code">💻 XML 源码</button>
        </div>`
            : `<div class="badge-tag">XML 源码模式</div>`
        }
      </div>

      <div class="header-center">
        <div class="search-box">
          <span class="search-icon">🔍</span>
          <input type="text" id="search-input" placeholder="在 XML 中搜索节点或文本..." />
          <span class="search-count" id="search-count"></span>
        </div>
      </div>

      <div class="header-right">
        <button class="action-btn" id="btn-collapse" title="全部折叠">
          <span>⤓</span> 全部折叠
        </button>
        <button class="action-btn" id="btn-expand" title="全部展开">
          <span>⤒</span> 全部展开
        </button>
        <button class="action-btn" id="btn-copy" title="复制排版后的 XML">
          <span>📋</span> 复制 XML
        </button>
        <button class="action-btn" id="btn-download" title="下载 XML 文件">
          <span>💾</span> 下载
        </button>
        <button class="action-btn icon-only" id="btn-theme" title="切换明暗主题">
          🌓
        </button>
        <button class="action-btn exit-btn" id="btn-exit" title="还原原生视图">
          ✕ 退出排版
        </button>
      </div>
    </header>

    <main class="content">
      ${
        hasFeed
          ? `
      <div class="reader-view" id="reader-view">
        <div class="reader-container">
          <div class="channel-card">
            <div class="channel-header">
              ${
                feedData.imageUrl
                  ? `<img src="${feedData.imageUrl}" class="channel-avatar" alt="Channel Icon"/>`
                  : `<div class="channel-avatar placeholder">📡</div>`
              }
              <div class="channel-meta">
                <h1 class="channel-title">
                  <a href="${feedData.link}" target="_blank" rel="noopener noreferrer">${escapeHtml(feedData.title)}</a>
                  <span class="channel-badge">${feedData.type.toUpperCase()}</span>
                </h1>
                ${
                  feedData.description
                    ? `<p class="channel-desc">${escapeHtml(feedData.description)}</p>`
                    : ""
                }
                <div class="channel-subinfo">
                  ${
                    feedData.lastBuildDate
                      ? `<span>🕒 更新时间: ${formatHumanDate(feedData.lastBuildDate)}</span>`
                      : ""
                  }
                  ${
                    feedData.generator
                      ? `<span>⚙️ 来源: ${escapeHtml(feedData.generator)}</span>`
                      : ""
                  }
                  <span>📊 共 ${feedData.items.length} 篇文章</span>
                </div>
              </div>
            </div>
          </div>
          <div class="feed-items-list" id="feed-list">
            ${feedData.items
              .map(
                (item, idx) => `
              <article class="feed-item-card" data-index="${idx}">
                <div class="item-header">
                  <h2 class="item-title">
                    <a href="${item.link || "#"}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title)}</a>
                  </h2>
                  <div class="item-meta">
                    ${item.pubDate ? `<span class="meta-date">🕒 ${formatHumanDate(item.pubDate)}</span>` : ""}
                    ${item.author ? `<span class="meta-author">✍️ ${escapeHtml(item.author)}</span>` : ""}
                    ${item.categories.map((c) => `<span class="meta-tag">#${escapeHtml(c)}</span>`).join("")}
                  </div>
                </div>
                <div class="item-body">
                  ${item.content || "<p style='color:#94a3b8;font-style:italic;'>无详细内容</p>"}
                </div>
                <div class="item-footer">
                  ${item.link ? `<a href="${item.link}" target="_blank" rel="noopener noreferrer" class="item-link-btn">阅读原文 ↗</a>` : ""}
                </div>
              </article>`
              )
              .join("")}
          </div>
        </div>
      </div>`
          : ""
      }

      <div class="code-view ${hasFeed ? "hidden" : "active"}" id="code-view">
        <div class="xml-code-container" id="xml-code-box"></div>
      </div>
    </main>

    <div class="toast" id="toast"></div>
  </div>
</body>
</html>`);
  doc.close();

  // 格式化时间
  function formatHumanDate(dateStr) {
    if (!dateStr) return "";
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      const h = String(d.getHours()).padStart(2, "0");
      const min = String(d.getMinutes()).padStart(2, "0");
      return `${y}-${m}-${day} ${h}:${min}`;
    } catch (_) {
      return dateStr;
    }
  }

  function escapeHtml(str) {
    return (str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // 构建代码树节点
  function createXmlDomTree(node, depth = 0) {
    const container = doc.createElement("div");
    container.className = "xml-node-line";
    container.style.paddingLeft = `${depth * 18}px`;

    if (node.nodeType === Node.COMMENT_NODE) {
      container.innerHTML = `<span class="xml-comment">&lt;!-- ${escapeHtml(node.nodeValue)} --&gt;</span>`;
      return container;
    }

    if (node.nodeType === Node.CDATA_SECTION_NODE) {
      container.innerHTML = `<span class="xml-cdata">&lt;![CDATA[<span class="xml-cdata-content">${escapeHtml(node.nodeValue)}</span>]]&gt;</span>`;
      return container;
    }

    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.nodeValue.trim();
      if (!text) return null;
      container.innerHTML = `<span class="xml-text">${escapeHtml(text)}</span>`;
      return container;
    }

    if (node.nodeType === Node.ELEMENT_NODE) {
      const tagName = node.nodeName;
      const hasChildren = node.childNodes.length > 0;
      const isSimpleText =
        node.childNodes.length === 1 &&
        node.childNodes[0].nodeType === Node.TEXT_NODE;

      let attrsHtml = "";
      if (node.attributes && node.attributes.length > 0) {
        for (let i = 0; i < node.attributes.length; i++) {
          const attr = node.attributes[i];
          attrsHtml += ` <span class="xml-attr-name">${escapeHtml(attr.name)}</span>=<span class="xml-attr-val">"${escapeHtml(attr.value)}"</span>`;
        }
      }

      if (!hasChildren) {
        container.innerHTML = `<span class="xml-tag">&lt;<span class="xml-tag-name">${escapeHtml(tagName)}</span>${attrsHtml} /&gt;</span>`;
        return container;
      }

      if (isSimpleText) {
        const textVal = node.childNodes[0].nodeValue;
        if (textVal.length < 90 && !textVal.includes("\n")) {
          container.innerHTML = `<span class="xml-tag">&lt;<span class="xml-tag-name">${escapeHtml(tagName)}</span>${attrsHtml}&gt;</span><span class="xml-text">${escapeHtml(textVal)}</span><span class="xml-tag">&lt;/<span class="xml-tag-name">${escapeHtml(tagName)}</span>&gt;</span>`;
          return container;
        }
      }

      const nodeWrapper = doc.createElement("div");
      nodeWrapper.className = "xml-element-wrapper";

      const headerLine = doc.createElement("div");
      headerLine.className = "xml-node-line xml-node-header";
      headerLine.style.paddingLeft = `${depth * 18}px`;

      const foldToggle = doc.createElement("span");
      foldToggle.className = "xml-fold-btn";
      foldToggle.innerHTML = "▾";
      headerLine.appendChild(foldToggle);

      const openTag = doc.createElement("span");
      openTag.className = "xml-tag";
      openTag.innerHTML = `&lt;<span class="xml-tag-name">${escapeHtml(tagName)}</span>${attrsHtml}&gt;`;
      headerLine.appendChild(openTag);

      const ellipsis = doc.createElement("span");
      ellipsis.className = "xml-collapsed-ellipsis";
      ellipsis.textContent = "...";
      ellipsis.style.display = "none";
      headerLine.appendChild(ellipsis);

      const closeTagInline = doc.createElement("span");
      closeTagInline.className = "xml-tag xml-tag-inline-close";
      closeTagInline.innerHTML = `&lt;/<span class="xml-tag-name">${escapeHtml(tagName)}</span>&gt;`;
      closeTagInline.style.display = "none";
      headerLine.appendChild(closeTagInline);

      nodeWrapper.appendChild(headerLine);

      const childrenBox = doc.createElement("div");
      childrenBox.className = "xml-children-box";

      for (let i = 0; i < node.childNodes.length; i++) {
        const childEl = createXmlDomTree(node.childNodes[i], depth + 1);
        if (childEl) childrenBox.appendChild(childEl);
      }
      nodeWrapper.appendChild(childrenBox);

      const footerLine = doc.createElement("div");
      footerLine.className = "xml-node-line xml-node-footer";
      footerLine.style.paddingLeft = `${depth * 18}px`;
      footerLine.innerHTML = `<span class="xml-fold-placeholder"></span><span class="xml-tag">&lt;/<span class="xml-tag-name">${escapeHtml(tagName)}</span>&gt;</span>`;
      nodeWrapper.appendChild(footerLine);

      foldToggle.addEventListener("click", (e) => {
        e.stopPropagation();
        const isCollapsed = childrenBox.style.display === "none";
        if (isCollapsed) {
          childrenBox.style.display = "block";
          footerLine.style.display = "block";
          ellipsis.style.display = "none";
          closeTagInline.style.display = "none";
          foldToggle.innerHTML = "▾";
          foldToggle.classList.remove("collapsed");
        } else {
          childrenBox.style.display = "none";
          footerLine.style.display = "none";
          ellipsis.style.display = "inline";
          closeTagInline.style.display = "inline";
          foldToggle.innerHTML = "▸";
          foldToggle.classList.add("collapsed");
        }
      });

      return nodeWrapper;
    }

    return null;
  }

  // 格式化文本
  function formatXmlString(xmlString, indent = "  ") {
    let formatted = "";
    let pad = 0;
    const regex = /(>)(<)(\/*)/g;
    const sanitized = xmlString.replace(regex, "$1\r\n$2$3");
    const lines = sanitized.split("\r\n");

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i].trim();
      if (!line) continue;

      let indentLevel = 0;
      if (line.match(/^<\/\w/)) {
        if (pad !== 0) pad -= 1;
      } else if (
        line.match(/^<\w[^>]*[^\/]>.*$/) &&
        !line.match(/^<.*\/>/) &&
        !line.includes("</")
      ) {
        indentLevel = 1;
      }

      formatted += indent.repeat(pad) + line + "\n";
      pad += indentLevel;
    }

    return formatted.trim();
  }

  // 填充代码树
  const codeBox = doc.getElementById("xml-code-box");
  if (xmlDoc && xmlDoc.documentElement) {
    const treeDom = createXmlDomTree(xmlDoc.documentElement, 0);
    if (treeDom) {
      codeBox.appendChild(treeDom);
    } else {
      codeBox.innerHTML = `<pre class="fallback-pre">${escapeHtml(rawXml)}</pre>`;
    }
  } else {
    codeBox.innerHTML = `<pre class="fallback-pre">${escapeHtml(rawXml)}</pre>`;
  }

  // 事件交互
  const tabReader = doc.getElementById("tab-reader");
  const tabCode = doc.getElementById("tab-code");
  const readerView = doc.getElementById("reader-view");
  const codeView = doc.getElementById("code-view");

  if (tabReader && tabCode && readerView) {
    tabReader.addEventListener("click", () => {
      tabReader.classList.add("active");
      tabCode.classList.remove("active");
      readerView.classList.remove("hidden");
      codeView.classList.add("hidden");
    });

    tabCode.addEventListener("click", () => {
      tabCode.classList.add("active");
      tabReader.classList.remove("active");
      codeView.classList.remove("hidden");
      readerView.classList.add("hidden");
    });
  }

  // 明暗主题切换
  const body = doc.body;
  const themeBtn = doc.getElementById("btn-theme");
  themeBtn?.addEventListener("click", () => {
    if (body.classList.contains("theme-dark")) {
      body.classList.remove("theme-dark");
      body.classList.add("theme-light");
      iframe.style.background = "#f8fafc";
      iframe.style.colorScheme = "light";
    } else {
      body.classList.remove("theme-light");
      body.classList.add("theme-dark");
      iframe.style.background = "#0b1120";
      iframe.style.colorScheme = "dark";
    }
  });

  // 全部折叠 / 展开
  const btnCollapse = doc.getElementById("btn-collapse");
  const btnExpand = doc.getElementById("btn-expand");

  btnCollapse?.addEventListener("click", () => {
    if (tabCode && !tabCode.classList.contains("active")) {
      tabCode.click();
    }
    doc.querySelectorAll(".xml-element-wrapper").forEach((el) => {
      const header = el.querySelector(":scope > .xml-node-header");
      const toggle = header?.querySelector(".xml-fold-btn");
      const children = el.querySelector(":scope > .xml-children-box");
      const footer = el.querySelector(":scope > .xml-node-footer");
      const ellipsis = header?.querySelector(".xml-collapsed-ellipsis");
      const closeTag = header?.querySelector(".xml-tag-inline-close");
      if (toggle && children) {
        children.style.display = "none";
        if (footer) footer.style.display = "none";
        if (ellipsis) ellipsis.style.display = "inline";
        if (closeTag) closeTag.style.display = "inline";
        toggle.innerHTML = "▸";
        toggle.classList.add("collapsed");
      }
    });
  });

  btnExpand?.addEventListener("click", () => {
    if (tabCode && !tabCode.classList.contains("active")) {
      tabCode.click();
    }
    doc.querySelectorAll(".xml-element-wrapper").forEach((el) => {
      const header = el.querySelector(":scope > .xml-node-header");
      const toggle = header?.querySelector(".xml-fold-btn");
      const children = el.querySelector(":scope > .xml-children-box");
      const footer = el.querySelector(":scope > .xml-node-footer");
      const ellipsis = header?.querySelector(".xml-collapsed-ellipsis");
      const closeTag = header?.querySelector(".xml-tag-inline-close");
      if (toggle && children) {
        children.style.display = "block";
        if (footer) footer.style.display = "block";
        if (ellipsis) ellipsis.style.display = "none";
        if (closeTag) closeTag.style.display = "none";
        toggle.innerHTML = "▾";
        toggle.classList.remove("collapsed");
      }
    });
  });

  function showToast(text) {
    const toast = doc.getElementById("toast");
    if (toast) {
      toast.textContent = text;
      toast.classList.add("show");
      setTimeout(() => toast.classList.remove("show"), 2200);
    }
  }

  // 复制
  const btnCopy = doc.getElementById("btn-copy");
  btnCopy?.addEventListener("click", async () => {
    const formatted = formatXmlString(rawXml);
    try {
      await navigator.clipboard.writeText(formatted);
      showToast("已复制格式化 XML 到剪贴板 ✓");
    } catch (_) {
      const ta = doc.createElement("textarea");
      ta.value = formatted;
      doc.body.appendChild(ta);
      ta.select();
      doc.execCommand("copy");
      ta.remove();
      showToast("已复制格式化 XML 到剪贴板 ✓");
    }
  });

  // 下载
  const btnDownload = doc.getElementById("btn-download");
  btnDownload?.addEventListener("click", () => {
    const formatted = formatXmlString(rawXml);
    const blob = new Blob([formatted], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const a = doc.createElement("a");
    let filename = "document.xml";
    try {
      const path = window.location.pathname;
      const lastSeg = path.split("/").filter(Boolean).pop();
      if (lastSeg) {
        filename = lastSeg.endsWith(".xml") ? lastSeg : `${lastSeg}.xml`;
      }
    } catch (_) {}
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`已下载 ${filename} ✓`);
  });

  // 退出排版，恢复原生
  const btnExit = doc.getElementById("btn-exit");
  btnExit?.addEventListener("click", () => {
    iframe.remove();
  });

  // 搜索
  const searchInput = doc.getElementById("search-input");
  const searchCount = doc.getElementById("search-count");
  let searchDebounce = null;

  searchInput?.addEventListener("input", () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      const query = searchInput.value.trim().toLowerCase();

      // 清除旧高亮
      doc.querySelectorAll(".xml-highlight").forEach((hl) => {
        const parent = hl.parentNode;
        parent.replaceChild(doc.createTextNode(hl.textContent), hl);
        parent.normalize();
      });

      if (!query) {
        searchCount.textContent = "";
        if (readerView) {
          readerView.querySelectorAll(".feed-item-card").forEach((item) => {
            item.style.display = "";
          });
        }
        return;
      }

      let matchCount = 0;
      if (readerView && !readerView.classList.contains("hidden")) {
        readerView.querySelectorAll(".feed-item-card").forEach((item) => {
          const text = item.textContent.toLowerCase();
          if (text.includes(query)) {
            item.style.display = "";
            matchCount++;
          } else {
            item.style.display = "none";
          }
        });
        searchCount.textContent = `找到 ${matchCount} 条文章`;
      } else {
        const textNodes = [];
        const walker = doc.createTreeWalker(
          codeView,
          NodeFilter.SHOW_TEXT,
          null,
          false
        );
        let n;
        while ((n = walker.nextNode())) {
          if (
            n.parentNode &&
            !n.parentNode.classList?.contains("xml-fold-btn") &&
            n.nodeValue.toLowerCase().includes(query)
          ) {
            textNodes.push(n);
          }
        }

        textNodes.forEach((node) => {
          const val = node.nodeValue;
          const regex = new RegExp(
            query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
            "gi"
          );
          let match;
          const frag = doc.createDocumentFragment();
          let lastIdx = 0;
          while ((match = regex.exec(val)) !== null) {
            matchCount++;
            frag.appendChild(
              doc.createTextNode(val.substring(lastIdx, match.index))
            );
            const mark = doc.createElement("mark");
            mark.className = "xml-highlight";
            mark.textContent = match[0];
            frag.appendChild(mark);
            lastIdx = regex.lastIndex;
          }
          frag.appendChild(doc.createTextNode(val.substring(lastIdx)));
          node.parentNode.replaceChild(frag, node);
        });

        searchCount.textContent = `找到 ${matchCount} 处匹配`;
      }
    }, 250);
  });

  return {
    success: true,
    isXml: true,
    hasFeed,
    feedTitle: feedData?.title,
    itemCount: feedData?.items?.length,
  };
})();
