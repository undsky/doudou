// 检查是否从文章复刻来
(async function () {
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get("source") === "background_import") {
    try {
      const { pending_post_import } = await chrome.storage.local.get(
        "pending_post_import"
      );

      if (pending_post_import) {
        // Read existing posts
        let posts = [];
        try {
          const storedPosts = localStorage.getItem("MD__posts");
          if (storedPosts) posts = JSON.parse(storedPosts);
        } catch (e) {}

        // Add new post
        posts.push(pending_post_import);
        localStorage.setItem("MD__posts", JSON.stringify(posts));
        localStorage.setItem("MD__current_post_id", pending_post_import.id);

        // Clear pending data
        await chrome.storage.local.remove("pending_post_import");

        // Remove param and reload to refresh app state
        const newUrl = window.location.href.split("?")[0];
        window.location.href = newUrl;
        return;
      }
    } catch (e) {
      console.error("后台导入文章失败:", e);
    }
  }

  if (urlParams.get("source") === "clone") {
    try {
      const result = await chrome.storage.local.get([
        "cloneArticleContent",
        "cloneArticleTimestamp",
      ]);
      const content = result.cloneArticleContent;
      const timestamp = result.cloneArticleTimestamp;

      // 检查内容是否有效（5分钟内）
      if (content && timestamp && Date.now() - timestamp < 5 * 60 * 1000) {
        // 清除已使用的内容
        await chrome.storage.local.remove([
          "cloneArticleContent",
          "cloneArticleTimestamp",
        ]);

        // 等待编辑器加载完成
        const waitForEditor = () => {
          return new Promise((resolve) => {
            const checkEditor = () => {
              // 查找 CodeMirror 编辑器
              const editor = document.querySelector(".CodeMirror");
              if (editor && editor.CodeMirror) {
                resolve(editor.CodeMirror);
              } else {
                setTimeout(checkEditor, 100);
              }
            };
            checkEditor();
          });
        };

        const editor = await waitForEditor();
        editor.setValue(content);
        console.log("文章复刻内容已加载到编辑器");
      }
    } catch (error) {
      console.error("加载复刻内容失败:", error);
    }
  }
})();
