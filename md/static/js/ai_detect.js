// AI 检测功能注入脚本
// 在 header 区域注入检测按钮，点击后打开腾讯 Matrix AI 检测页面并将内容自动填入

(function () {
  "use strict";

  // 等待页面加载完成
  const waitForHeader = () => {
    return new Promise((resolve) => {
      const checkHeader = () => {
        const header = document.querySelector("header");
        // 查找与 docx_export 相同的容器，确保按钮排列在一起
        const flexContainer = header?.querySelector(
          ".flex.flex-wrap.items-center.gap-2"
        );
        if (flexContainer) {
          resolve(flexContainer);
        } else {
          setTimeout(checkHeader, 100);
        }
      };
      checkHeader();
    });
  };

  // 获取当前 markdown 内容 (复用 docx_export.js 的逻辑)
  const getMarkdownContent = () => {
    let content = "";

    // 1. 尝试从 Pinia 获取
    try {
      const appEl = document.querySelector("#app");
      if (appEl && appEl.__vue_app__) {
        const vueApp = appEl.__vue_app__;
        const pinia =
          vueApp._context.provides?.pinia ||
          vueApp._context.config.globalProperties?.$pinia;
        if (pinia?.state?.value?.editor?.editor?.state?.doc) {
          content = pinia.state.value.editor.editor.state.doc.toString();
        }
      }
    } catch (e) {}

    // 2. 尝试从 CodeMirror 6 获取
    if (!content) {
      try {
        const cmEditor = document.querySelector(".cm-editor");
        const view = cmEditor?.cmView?.view || cmEditor?._view;
        if (view?.state?.doc) {
          content = view.state.doc.toString();
        }
      } catch (e) {}
    }

    // 3. 兜底，获取 innerText
    if (!content) {
      const cm6Content = document.querySelector(".cm-content");
      if (cm6Content) {
        content = cm6Content.innerText || cm6Content.textContent || "";
      }
    }

    return content || "";
  };

  // 在新标签页中注入内容的脚本
  // 注意：这个函数会被序列化并注入到目标页面，不能引用外部变量
  function injectContentScript(markdownText) {
    console.log("[AI Detect] 开始注入内容...");

    // 轮询查找输入框
    const waitForElement = (selector, timeout = 10000) => {
      return new Promise((resolve, reject) => {
        const startTime = Date.now();
        const check = () => {
          const el = document.querySelector(selector);
          if (el) {
            resolve(el);
          } else if (Date.now() - startTime > timeout) {
            reject(new Error(`Timeout finding element: ${selector}`));
          } else {
            setTimeout(check, 500);
          }
        };
        check();
      });
    };

    const run = async () => {
      try {
        // 等待 textarea 出现
        // 用户提供的 DOM 结构: <textarea ... class="el-textarea__inner" ...>
        const textarea = await waitForElement("textarea.el-textarea__inner");

        // 模拟输入
        textarea.value = markdownText;
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
        textarea.dispatchEvent(new Event("change", { bubbles: true }));

        // 等待一下，让 Vue/React 响应数据变化
        await new Promise((r) => setTimeout(r, 500));

        // 查找并点击提交按钮
        // 用户提供的 DOM: <button ... class="el-button submit-btn el-button--primary"> ... <span> 立即检测... </span> ... </button>
        // 也可以通过文本内容查找
        const buttons = Array.from(
          document.querySelectorAll("button.submit-btn")
        );
        const submitBtn =
          buttons.find((btn) => btn.innerText.includes("检测")) || buttons[0];

        if (submitBtn) {
          if (submitBtn.disabled) {
            console.warn("[AI Detect] 按钮被禁用，可能是字数不足或次数用完");
          } else {
            submitBtn.click();
            console.log("[AI Detect] 已触发检测点击");
          }
        } else {
          console.error("[AI Detect] 未找到提交按钮");
        }
      } catch (err) {
        console.error("[AI Detect] 注入过程出错:", err);
      }
    };

    run();
  }

  // 打开 AI 检测页面
  const openAiDetect = async () => {
    const content = getMarkdownContent();
    if (!content || content.trim().length < 10) {
      alert("内容太少，请先输入一些文章内容（建议大于10字）");
      return;
    }

    const targetUrl = "https://matrix.tencent.com/ai-detect/";

    // 使用 chrome.tabs 创建新标签页
    // 如果没有 chrome API (例如只是普通网页运行), 则只能 window.open 且无法自动注入
    if (typeof chrome !== "undefined" && chrome.tabs && chrome.scripting) {
      chrome.tabs.create({ url: targetUrl }, (tab) => {
        // 监听标签页更新，等待加载完成
        const listener = (tabId, changeInfo, tabInfo) => {
          if (tabId === tab.id && changeInfo.status === "complete") {
            // 移除监听器，避免重复执行
            chrome.tabs.onUpdated.removeListener(listener);

            // 执行注入脚本
            chrome.scripting
              .executeScript({
                target: { tabId: tabId },
                func: injectContentScript,
                args: [content],
              })
              .catch((err) => {
                console.error("[AI Detect] Script injection failed:", err);
                alert("自动填入失败，请手动粘贴内容。错误: " + err.message);
              });
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
      });
    } else {
      // 降级处理：仅打开页面，并复制内容到剪贴板
      try {
        await navigator.clipboard.writeText(content);
        alert("已将内容复制到剪贴板。正在打开检测页面，请直接粘贴。");
      } catch (e) {
        alert("无法访问剪贴板，请手动复制内容。");
      }
      window.open(targetUrl, "_blank");
    }
  };

  // 创建 AI 检测按钮
  const createAiDetectButton = () => {
    const button = document.createElement("button");
    // 复用 docx_export 的样式类
    button.className =
      "inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-9 rounded-md px-3";
    button.title = "AI 内容检测";
    button.style.marginLeft = "8px"; // 加一点间距
    button.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-scan-eye">
        <path d="M3 7V5a2 2 0 0 1 2-2h2"></path>
        <path d="M17 3h2a2 2 0 0 1 2 2v2"></path>
        <path d="M21 17v2a2 2 0 0 1-2 2h-2"></path>
        <path d="M7 21H5a2 2 0 0 1-2-2v-2"></path>
        <circle cx="12" cy="12" r="1"></circle>
        <path d="M5 12a7 7 0 0 1 14 0"></path>
      </svg>
      <span>AI 检测</span>
    `;
    button.addEventListener("click", openAiDetect);
    return button;
  };

  // 初始化
  const init = async () => {
    try {
      const container = await waitForHeader();
      // 检查是否已经存在 (避免重复注入)
      if (container.querySelector('button[title="AI 内容检测"]')) return;

      const btn = createAiDetectButton();
      // 插入到容器中，可以放在最后，或者 docx 按钮旁边
      container.appendChild(btn);
      console.log("[AI Detect] 按钮已注入");
    } catch (error) {
      console.error("[AI Detect] 初始化失败:", error);
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    setTimeout(init, 1000);
  }
})();
