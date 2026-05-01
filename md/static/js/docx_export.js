// DOCX 导出功能注入脚本
// 使用 marked.js 解析 Markdown，docx.js 生成文档

(function () {
  "use strict";

  // 等待页面加载完成
  const waitForHeader = () => {
    return new Promise((resolve) => {
      const checkHeader = () => {
        const header = document.querySelector("header");
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

  // 获取当前 markdown 内容
  const getMarkdownContent = () => {
    let content = "";
    // 1. Pinia store
    try {
      const appEl = document.querySelector("#app");
      if (appEl && appEl.__vue_app__) {
        const vueApp = appEl.__vue_app__;
        const pinia =
          vueApp._context.provides?.pinia ||
          vueApp._context.config.globalProperties?.$pinia;

        if (pinia?.state?.value?.editor?.editor) {
          content = pinia.state.value.editor.editor.state.doc.toString();
        } else if (pinia?.state?.value?.post?.posts) {
            const currentId = pinia.state.value.post.currentPostId;
            const posts = pinia.state.value.post.posts;
            const currentPost = posts.find(p => p.id === currentId);
            if (currentPost) content = currentPost.content;
        }
      }
    } catch (e) {}

    // 2. CodeMirror 6 EditorView
    if (!content) {
      try {
        const cmEditor = document.querySelector(".cm-editor");
        if (cmEditor) {
          const view = cmEditor.cmView?.view || cmEditor._view;
          if (view?.state?.doc) {
            content = view.state.doc.toString();
          }
        }
      } catch (e) {}
    }

    // 3. CodeMirror 5
    if (!content) {
      const cmEditor = document.querySelector(".CodeMirror");
      if (cmEditor?.CodeMirror) {
        content = cmEditor.CodeMirror.getValue();
      }
    }
    
    // 4. LocalStorage
    if (!content) {
        try {
            const currentId = localStorage.getItem("MD__current_post_id");
            const posts = JSON.parse(localStorage.getItem("MD__posts") || "[]");
            const currentPost = posts.find(p => p.id === currentId);
            if (currentPost) content = currentPost.content || currentPost.markdown;
        } catch(e) {}
    }

    return content || "";
  };

  // 获取标题
  const getTitle = (content) => {
    // 1. 尝试从 Pinia Store 获取标题 (最准确)
    try {
      const appEl = document.querySelector("#app");
      if (appEl && appEl.__vue_app__) {
        const pinia = appEl.__vue_app__._context.provides?.pinia || 
                     appEl.__vue_app__._context.config.globalProperties?.$pinia;
        if (pinia?.state?.value?.post) {
            const { currentPostId, posts } = pinia.state.value.post;
            if (currentPostId && posts) {
                const currentPost = posts.find(p => p.id === currentPostId);
                // 确保标题不是默认生成的日期格式（如果用户没改过）或者确实有意义
                if (currentPost && currentPost.title && !currentPost.title.startsWith("202")) { 
                    return currentPost.title;
                }
                if (currentPost && currentPost.title) return currentPost.title;
            }
        }
      }
    } catch (e) {}

    // 2. 尝试从 LocalStorage 获取
    try {
        const currentId = localStorage.getItem("MD__current_post_id");
        if (currentId) {
            const posts = JSON.parse(localStorage.getItem("MD__posts") || "[]");
            const currentPost = posts.find(p => p.id === currentId);
            if (currentPost && currentPost.title) return currentPost.title;
        }
    } catch (e) {}

    // 3. 从 Markdown 内容提取第一个 H1
    const h1Match = content.match(/^#\s+(.+)$/m);
    if (h1Match) return h1Match[1].trim();

    // 4. 默认 fallback
    return "未命名文档";
  };

  // 动态加载库
  const loadLibrary = (url, globalVar) => {
    return new Promise((resolve, reject) => {
      if (window[globalVar]) {
        resolve(window[globalVar]);
        return;
      }
      const script = document.createElement("script");
      script.src = url;
      script.onload = () => resolve(window[globalVar]);
      script.onerror = reject;
      document.head.appendChild(script);
    });
  };

  // 解析 Markdown 并生成 DOCX 子元素
  const parseMarkdownToDocx = async (markdown, docxLib, markedLib) => {
    const { Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, BorderStyle, WidthType, ImageRun, ExternalHyperlink } = docxLib;

    const tokens = markedLib.lexer(markdown);
    
    const children = [];

    // 辅助：解析 inline tokens (bold, italic, text, link, code)
    const processInline = (inlineTokens) => {
        const runs = [];
        if (!inlineTokens) return runs;

        for (const token of inlineTokens) {
            if (token.type === 'text') {
                // 处理可能的 HTML 实体或简单文本
               runs.push(new TextRun({ text: token.text }));
            } 
            else if (token.type === 'escape') {
                runs.push(new TextRun({ text: token.text }));
            }
            else if (token.type === 'strong') {
                runs.push(new TextRun({ text: token.text, bold: true }));
            } 
            else if (token.type === 'em') {
                runs.push(new TextRun({ text: token.text, italics: true }));
            } 
            else if (token.type === 'codespan') {
                 runs.push(new TextRun({ 
                     text: token.text, 
                     font: "Courier New", 
                     color: "C7254E", 
                     shading: { fill: "F9F2F4", type: "clear", color: "auto" } 
                 }));
            } 
            else if (token.type === 'link') {
                runs.push(new ExternalHyperlink({
                    children: [
                        new TextRun({
                            text: token.text,
                            style: "Hyperlink",
                        }),
                    ],
                    link: token.href,
                }));
            }
            else if (token.type === 'image') {
                 // 图片在 inline 中比较特殊，docx 支持 ImageRun，但需要 blob/buffer
                 // 这里简单处理为显示图片描述和链接
                 runs.push(new TextRun({ text: `[图片: ${token.text || 'image'}]`, color: "888888", italics: true }));
            }
            // 递归处理嵌套 (marked simple inline tokens usually don't nest deep complexly except maybe strong inside em)
             else if (token.tokens) {
                 runs.push(...processInline(token.tokens));
            }
        }
        return runs;
    };

    // 异步处理块级 token
    for (const token of tokens) {
        switch (token.type) {
            case 'heading':
                const levels = [
                    HeadingLevel.HEADING_1,
                    HeadingLevel.HEADING_2,
                    HeadingLevel.HEADING_3,
                    HeadingLevel.HEADING_4,
                    HeadingLevel.HEADING_5,
                    HeadingLevel.HEADING_6
                ];
                children.push(new Paragraph({
                    heading: levels[token.depth - 1] || HeadingLevel.HEADING_1,
                    children: processInline(token.tokens),
                    spacing: { before: 240, after: 120 }
                }));
                break;

            case 'paragraph':
                // 检查是否包含图片 token
                const imageToken = token.tokens && token.tokens.length === 1 && token.tokens[0].type === 'image' ? token.tokens[0] : null;
                
                if (imageToken) {
                    try {
                        // 尝试下载图片
                        const resp = await fetch(imageToken.href);
                        if (resp.ok) {
                            const blob = await resp.blob();
                            children.push(new Paragraph({
                                children: [
                                    new ImageRun({
                                        data: blob,
                                        transformation: {
                                            width: 500, // 限制最大宽度
                                            height: 300 // 这里的宽高比例可能需要优化，简单起见固定或仅限宽
                                        },
                                    }),
                                ],
                            }));
                        } else {
                             throw new Error("Load failed");
                        }
                    } catch (e) {
                         children.push(new Paragraph({
                            children: [new TextRun({ text: `[图片加载失败: ${imageToken.text}]`, color: "FF0000" })]
                        }));
                    }
                } else {
                    children.push(new Paragraph({
                        children: processInline(token.tokens),
                        spacing: { after: 200 }
                    }));
                }
                break;

            case 'list':
                // 处理列表
                const processListItems = (items, level = 0, isOrdered = false) => {
                     const listParas = [];
                     for (const item of items) {
                         // 列表项的第一段
                         // marked 的 list item tokens 可能包含 parsed text in 'tokens'
                         // 或者 raw 'text'
                         // item.tokens 通常包含 'text' (type: text) 或者 children blocks
                         
                         // 简单起见，从 item.tokens 中提取 paragraph 或 text
                         let itemChildren = [];
                         
                         // 如果 item 有 task 属性 (checkbox)，暂忽略或加标记
                         let prefix = item.task ? (item.checked ? "[x] " : "[ ] ") : "";
                         
                         if(prefix) itemChildren.push(new TextRun({text: prefix, font: "Courier New"}));

                         // 遍历 item 内容
                         if (item.tokens) {
                             for(const subToken of item.tokens) {
                                  if(subToken.type === 'text' || subToken.type === 'paragraph') {
                                      // Append to inline runs
                                       if(subToken.tokens) {
                                           itemChildren.push(...processInline(subToken.tokens));
                                       } else {
                                           itemChildren.push(new TextRun(subToken.text));
                                       }
                                  } else if (subToken.type === 'list') {
                                      // 嵌套列表，递归处理 (docx 实际上是通过 level 控制嵌套)
                                      // 但是 docx 的 list 结构是平铺的 Paragraphs，通过 numbering level 区分
                                      // 这里我们先处理当前 item，然后递归追加子列表
                                      // 注意：docx 库的列表是基于 Paragraph 属性的
                                  }
                             }
                         } else {
                             itemChildren.push(new TextRun(item.text));
                         }

                         listParas.push(new Paragraph({
                             children: itemChildren,
                             bullet: isOrdered ? undefined : { level: level },
                             numbering: isOrdered ? { reference: "default-numbering", level: level } : undefined,
                             spacing: { after: 100 }
                         }));
                         
                         // 检查是否有嵌套列表
                         if (item.tokens) {
                             for(const subToken of item.tokens) {
                                 if (subToken.type === 'list') {
                                     listParas.push(...processListItems(subToken.items, level + 1, subToken.ordered));
                                 }
                             }
                         }
                     }
                     return listParas;
                };
                children.push(...processListItems(token.items, 0, token.ordered));
                break;

            case 'code':
                children.push(new Paragraph({
                    children: [
                        new TextRun({
                            text: token.text,
                            font: "Courier New",
                            size: 20
                        })
                    ],
                    shading: { fill: "F5F5F5", type: "clear", color: "auto" },
                    indent: { left: 360, right: 360 },
                    spacing: { after: 200 }
                }));
                break;

            case 'blockquote':
                // blockquote 在 marked 中通常包含 tokens (paragraph 等)
                const quoteChildren = [];
                if (token.tokens) {
                     for (const t of token.tokens) {
                         if (t.type === 'paragraph') {
                             quoteChildren.push(...processInline(t.tokens));
                             quoteChildren.push(new TextRun({text: "\n"}));
                         }
                     }
                }
                children.push(new Paragraph({
                    children: quoteChildren,
                    indent: { left: 720 },
                    border: { left: { style: BorderStyle.SINGLE, size: 24, space: 120, color: "CCCCCC" } },
                    spacing: { after: 240 }
                }));
                break;

            case 'table':
                 const tableRows = [];
                 // Header
                 tableRows.push(new TableRow({
                     children: token.header.map(cell => new TableCell({
                         children: [new Paragraph({ 
                             children: processInline(cell.tokens), 
                             alignment: "center" 
                         })],
                         shading: { fill: "EEEEEE" },
                         verticalAlign: "center",
                     }))
                 }));
                 // Body
                 for (const row of token.rows) {
                     tableRows.push(new TableRow({
                         children: row.map(cell => new TableCell({
                             children: [new Paragraph({ children: processInline(cell.tokens) })],
                             verticalAlign: "center",
                         }))
                     }));
                 }
                 children.push(new Table({
                     rows: tableRows,
                     width: { size: 100, type: WidthType.PERCENTAGE },
                     spacing: { after: 240 }
                 }));
                 break;
            
            case 'hr':
                children.push(new Paragraph({
                    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "999999" } },
                    spacing: { after: 240 }
                }));
                break;

            case 'space':
                // 忽略
                break;

            default:
                console.warn("Unhandled token type:", token.type);
                break;
        }
    }

    return children;
  };

  // 导出功能
  const exportToDocx = async () => {
    try {
      const markdown = getMarkdownContent();
      if (!markdown.trim()) {
        alert("没有内容可导出");
        return;
      }
      
      const docxLib = await loadLibrary("/md/static/js/docx.umd.min.js", "docx");
      const markedLib = await loadLibrary("/md/static/js/marked.min.js", "marked");
      
      const { Document, Packer, Paragraph, TextRun } = docxLib;
      
      const children = await parseMarkdownToDocx(markdown, docxLib, markedLib);
      
      const doc = new Document({
        sections: [{
          properties: {},
          children: children
        }],
        styles: {
            paragraphStyles: [
                {
                    id: "Hyperlink",
                    name: "Hyperlink",
                    basedOn: "Normal",
                    next: "Normal",
                    run: {
                        color: "0563C1",
                        underline: {
                            type: "single",
                        },
                    },
                },
            ]
        }
      });

      const blob = await Packer.toBlob(doc);
      const title = getTitle(markdown);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${title}.docx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      console.log("[DOCX Export] 导出成功:", `${title}.docx`);

    } catch (error) {
      console.error("[DOCX Export] 错误:", error);
      alert("DOCX 导出失败: " + error.message);
    }
  };

  // 创建按钮
  const createExportButton = () => {
    const button = document.createElement("button");
    button.className = "inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-9 rounded-md px-3";
    button.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-download"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
      导出 DOCX
    `;
    button.addEventListener("click", exportToDocx);
    return button;
  };

  // 初始化
  const init = async () => {
    try {
      const container = await waitForHeader();
      // 检查是否已存在
      let exists = false;
      container.querySelectorAll("button").forEach(btn => {
          if(btn.textContent.includes("导出 DOCX")) exists = true;
      });
      if(exists) return;

      const btn = createExportButton();
      container.appendChild(btn);
      console.log("[DOCX Export] 按钮注入成功");
    } catch (e) {
      console.error(e);
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    setTimeout(init, 1000);
  }

})();
