// DOCX 导入功能注入脚本
// 使用 mammoth.js 将 DOCX 转换为 HTML，再用 Turndown 转为 Markdown

(function () {
  "use strict";

  // 等待页面加载完成，查找导出按钮并在旁边添加导入按钮
  const waitForExportButton = () => {
    return new Promise((resolve) => {
      const checkButton = () => {
        // 查找导出按钮（含有 "导出 DOCX" 或 "导出为 DOCX" 文字的按钮）
        const buttons = document.querySelectorAll("button");
        for (const btn of buttons) {
          if (btn.textContent.includes("导出 DOCX") || btn.textContent.includes("导出为 DOCX")) {
            resolve(btn);
            return;
          }
        }
        setTimeout(checkButton, 100);
      };
      checkButton();
    });
  };

  // 动态加载 mammoth.js 库
  const loadMammothLibrary = () => {
    return new Promise((resolve, reject) => {
      if (window.mammoth) {
        resolve(window.mammoth);
        return;
      }
      const script = document.createElement("script");
      script.src = "/md/static/js/mammoth.browser.min.js";
      script.onload = () => resolve(window.mammoth);
      script.onerror = reject;
      document.head.appendChild(script);
    });
  };

  // 动态加载 Turndown 库
  const loadTurndownLibrary = () => {
    return new Promise((resolve, reject) => {
      if (window.TurndownService) {
        resolve(window.TurndownService);
        return;
      }
      const script = document.createElement("script");
      script.src = "/md/static/js/turndown.js";
      script.onload = () => resolve(window.TurndownService);
      script.onerror = reject;
      document.head.appendChild(script);
    });
  };

  // 动态加载 Turndown 通用规则
  const loadTurndownRules = () => {
    return new Promise((resolve, reject) => {
      if (window.addTurndownRules) {
        resolve(window.addTurndownRules);
        return;
      }
      const script = document.createElement("script");
      script.src = "/src/utils/turndown-rules.js";
      script.onload = () => resolve(window.addTurndownRules);
      script.onerror = reject;
      document.head.appendChild(script);
    });
  };

  // 使用 Turndown 将 HTML 转换为 Markdown
  const htmlToMarkdown = async (html) => {
    const TurndownService = await loadTurndownLibrary();
    const addTurndownRules = await loadTurndownRules();
    const turndownService = new TurndownService();
    addTurndownRules(turndownService);

    return turndownService.turndown(html);
  };

  // 设置编辑器内容
  const setEditorContent = (markdown) => {
    try {
      // 1. 尝试通过 Pinia store 设置内容
      const appEl = document.querySelector("#app");
      if (appEl && appEl.__vue_app__) {
        const vueApp = appEl.__vue_app__;
        const pinia =
          vueApp._context.provides?.pinia ||
          vueApp._context.config.globalProperties?.$pinia;

        if (pinia && pinia.state && pinia.state.value) {
          const editorStore = pinia.state.value.editor;
          if (editorStore && editorStore.editor) {
            const editorView = editorStore.editor;
            if (editorView && editorView.dispatch) {
              // 使用 CodeMirror 6 的 dispatch 方法替换内容
              editorView.dispatch({
                changes: {
                  from: 0,
                  to: editorView.state.doc.length,
                  insert: markdown,
                },
              });
              console.log("[DOCX Import] 通过 Pinia EditorView 设置内容成功");
              return true;
            }
          }
        }
      }

      // 2. 尝试通过 CodeMirror 6 EditorView 直接设置
      const cmEditor = document.querySelector(".cm-editor");
      if (cmEditor) {
        const view = cmEditor.cmView?.view || cmEditor._view;
        if (view && view.dispatch) {
          view.dispatch({
            changes: {
              from: 0,
              to: view.state.doc.length,
              insert: markdown,
            },
          });
          console.log("[DOCX Import] 通过 CodeMirror 6 EditorView 设置内容成功");
          return true;
        }
      }

      // 3. 尝试通过 CodeMirror 5 设置
      const cm5Editor = document.querySelector(".CodeMirror");
      if (cm5Editor && cm5Editor.CodeMirror) {
        cm5Editor.CodeMirror.setValue(markdown);
        console.log("[DOCX Import] 通过 CodeMirror 5 设置内容成功");
        return true;
      }

      console.error("[DOCX Import] 无法找到编辑器实例");
      return false;
    } catch (e) {
      console.error("[DOCX Import] 设置内容失败:", e);
      return false;
    }
  };

  // 导入 DOCX 文件
  const importDocx = async (file) => {
    try {
      console.log("[DOCX Import] 开始导入:", file.name);

      const mammoth = await loadMammothLibrary();
      const arrayBuffer = await file.arrayBuffer();

      // 使用 mammoth 转换 DOCX 为 HTML
      const result = await mammoth.convertToHtml({ arrayBuffer });

      if (result.messages.length > 0) {
        console.log("[DOCX Import] 转换消息:", result.messages);
      }

      // 使用 Turndown 将 HTML 转换为 Markdown
      const markdown = await htmlToMarkdown(result.value);

      // 设置到编辑器
      if (setEditorContent(markdown)) {
        console.log("[DOCX Import] 导入成功，Markdown 长度:", markdown.length);
      } else {
        alert("无法设置编辑器内容，请手动粘贴");
        console.log(markdown);
      }
    } catch (error) {
      console.error("[DOCX Import] 导入失败:", error);
      alert("DOCX 导入失败: " + error.message);
    }
  };

  // 创建隐藏的文件输入
  const createFileInput = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".docx";
    input.style.display = "none";
    input.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (file) {
        importDocx(file);
      }
      input.value = ""; // 重置，允许选择同一文件
    });
    document.body.appendChild(input);
    return input;
  };

  // 创建导入按钮
  const createImportButton = () => {
    const button = document.createElement("button");
    button.className =
      "inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-9 rounded-md px-3";
    button.title = "导入 DOCX";
    button.innerHTML = `<span>导入 DOCX</span>`;

    const fileInput = createFileInput();
    button.addEventListener("click", () => {
      fileInput.click();
    });

    return button;
  };

  // 初始化
  const init = async () => {
    try {
      const exportButton = await waitForExportButton();
      const importButton = createImportButton();
      // 插入到导出按钮之前（即放在导出按钮左边）
      exportButton.parentNode.insertBefore(importButton, exportButton);
      console.log("[DOCX Import] 导入按钮已注入到导出按钮旁边");
    } catch (error) {
      console.error("[DOCX Import] 初始化失败:", error);
    }
  };

  // 等待 DOM 加载完成后初始化
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setTimeout(init, 1500));
  } else {
    setTimeout(init, 1500); // 等待导出按钮先加载
  }
})();
