/**
 * 抖音下载助手 - Content Script
 * v3.2.1 - 捕获视频请求头，修复下载权限问题
 */

(function() {
  'use strict';

  if (window.douyinDownloaderInjected) return;
  window.douyinDownloaderInjected = true;

  // ==================== 全局变量 ====================
  
  // 存储捕获到的视频URL和请求头
  window.__dyVideoData = window.__dyVideoData || {
    urls: [],
    currentUrl: null,
    headers: {}
  };

  // 存储捕获到的图文图片数据 (aweme_id -> [url1, url2])
  window.__dyNoteData = window.__dyNoteData || {};

  // 存储捕获到的视频播放地址 (aweme_id -> videoUrl)
  window.__dyVideoMap = window.__dyVideoMap || {};

  // ==================== 工具函数 ====================

  // 安全挂载节点（防御 document.body 尚未加载完成即调用时抛 null 错误）
  function appendToBody(element) {
    if (!element) return;
    const parent = document.body || document.documentElement;
    if (parent) {
      parent.appendChild(element);
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        (document.body || document.documentElement).appendChild(element);
      }, { once: true });
    }
  }

  function showToast(message, duration = 3000) {
    const existing = document.querySelector('.douyin-downloader-toast');
    if (existing) existing.remove();
    
    const toast = document.createElement('div');
    toast.className = 'douyin-downloader-toast';
    toast.textContent = message;
    appendToBody(toast);
    setTimeout(() => toast.remove(), duration);
  }

  function setButtonState(btn, state) {
    if (!btn) return;
    btn.classList.remove('loading', 'success', 'error');
    if (state) btn.classList.add(state);
    setTimeout(() => btn.classList.remove('success', 'error'), 2000);
  }

  function createProgress(title) {
    const existing = document.querySelector('.douyin-downloader-progress');
    if (existing) existing.remove();
    
    const progress = document.createElement('div');
    progress.className = 'douyin-downloader-progress';
    progress.innerHTML = `
      <div class="douyin-downloader-progress-title">${title}</div>
      <div class="douyin-downloader-progress-bar">
        <div class="douyin-downloader-progress-fill" style="width: 0%"></div>
      </div>
      <div class="douyin-downloader-progress-text">准备中...</div>
    `;
    appendToBody(progress);
    return {
      update: (current, total, text = '') => {
        const percent = total > 0 ? Math.round((current / total) * 100) : 0;
        progress.querySelector('.douyin-downloader-progress-fill').style.width = `${percent}%`;
        progress.querySelector('.douyin-downloader-progress-text').textContent = text || `${current} / ${total}`;
      },
      close: () => {
        setTimeout(() => progress.remove(), 500);
      }
    };
  }

  // 参考项目图片 URL 特征检测：必须同时包含 douyinpic.com 且路径中包含 aweme_images
  function looksLikeDouyinImage(url) {
    if (!url || typeof url !== 'string') return false;
    return url.includes("douyinpic.com") && url.includes("aweme_images");
  }

  // 融合参考项目的 DOM 提取逻辑 (.focusPanel / .dySwiperSlide / .Stp1qoNr / aweme_images)
  function extractImagesFromReferenceDOM() {
    const images = [];
    const seenUrls = new Set();

    // 1. 寻找当前视口内可见且活性的 focusPanel 容器
    const panels = Array.from(document.querySelectorAll('.focusPanel, .GTuWw0eq.WtagMwIy.focusPanel'))
      .filter(el => el.offsetWidth > 0 && el.offsetHeight > 0);

    for (const panel of panels) {
      // 方式 A：通过主选择器 .dySwiperSlide 中的 .Stp1qoNr > img[src]
      const slides = Array.from(panel.querySelectorAll('.dySwiperSlide'));
      slides.forEach(slide => {
        const img = slide.querySelector('.Stp1qoNr > img[src], img[src]');
        if (img) {
          let src = img.getAttribute('src');
          if (src) {
            if (src.startsWith('//')) src = 'https:' + src;
            if (!seenUrls.has(src)) {
              seenUrls.add(src);
              images.push(src);
            }
          }
        }
      });

      if (images.length > 0) return images;

      // 方式 B：提取 panel 中所有包含 aweme_images 特征的图片
      const allImgs = Array.from(panel.querySelectorAll('img[src]'));
      allImgs.forEach(img => {
        let src = img.getAttribute('src');
        if (src && looksLikeDouyinImage(src)) {
          if (src.startsWith('//')) src = 'https:' + src;
          if (!seenUrls.has(src)) {
            seenUrls.add(src);
            images.push(src);
          }
        }
      });

      if (images.length > 0) return images;
    }

    // 2. 兜底：搜寻页面上所有包含 aweme_images 关键字的高清图集图片
    const globalImgs = Array.from(document.querySelectorAll('img[src]'));
    globalImgs.forEach(img => {
      let src = img.getAttribute('src');
      if (src && looksLikeDouyinImage(src)) {
        if (src.startsWith('//')) src = 'https:' + src;
        if (!seenUrls.has(src)) {
          seenUrls.add(src);
          images.push(src);
        }
      }
    });

    return images;
  }

  // 专用单张图片保存函数（融合参考项目的 createImageBitmap + Canvas 转换管线，防 403 且防 .htm 导出）
  async function downloadImageFile(url, filename) {
    try {
      const response = await fetch(url, {
        mode: "cors",
        credentials: "omit",
        cache: "force-cache",
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const sourceBlob = await response.blob();
      
      if (sourceBlob.type.includes('text/html') || sourceBlob.size < 500) {
        throw new Error('无效的图片响应数据');
      }

      let finalBlob = sourceBlob;

      // 使用参考项目的 ImageBitmap + Canvas 转换算法
      try {
        if (typeof createImageBitmap === "function") {
          const imageBitmap = await createImageBitmap(sourceBlob);
          const canvas = document.createElement("canvas");
          canvas.width = imageBitmap.width;
          canvas.height = imageBitmap.height;
          const context = canvas.getContext("2d");
          if (context) {
            context.drawImage(imageBitmap, 0, 0);
            const converted = await new Promise(r => canvas.toBlob(r, 'image/png'));
            if (converted) finalBlob = converted;
          }
          if (typeof imageBitmap.close === "function") imageBitmap.close();
        }
      } catch (err) {
        console.warn('[豆豆] ImageBitmap 转换跳过，使用原始 Blob:', err);
      }

      const objectUrl = URL.createObjectURL(finalBlob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = filename.replace(/\//g, '_');
      document.body.appendChild(a);
      a.click();
      a.remove();
      
      setTimeout(() => URL.revokeObjectURL(objectUrl), 3000);
      return { success: true };
    } catch (error) {
      console.warn('[豆豆] 页面内 Fetch 图片失败，尝试 Image + Canvas 绘制保存:', error);
      return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          try {
            if (img.naturalWidth > 0 && (img.naturalWidth < 250 || img.naturalHeight < 250)) {
              console.warn('[豆豆] 忽略尺寸过小的图标图片:', url);
              resolve({ success: false, error: '图标图片被忽略' });
              return;
            }

            const canvas = document.createElement("canvas");
            canvas.width = img.naturalWidth || img.width;
            canvas.height = img.naturalHeight || img.height;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0);
            canvas.toBlob((blob) => {
              if (blob) {
                const objectUrl = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = objectUrl;
                a.download = filename.replace(/\//g, '_');
                document.body.appendChild(a);
                a.click();
                a.remove();
                setTimeout(() => URL.revokeObjectURL(objectUrl), 3000);
                resolve({ success: true });
              } else {
                resolve({ success: false, error: 'Canvas 转换失败' });
              }
            }, "image/png", 0.95);
          } catch (e) {
            resolve({ success: false, error: e.message });
          }
        };
        img.onerror = () => resolve({ success: false, error: '图片加载失败' });
        img.src = url;
      });
    }
  }

  async function downloadDirectUrl(url, filename) {
    try {
      // 显示更长时间的提示，因为视频下载到内存可能需要十几秒
      showToast('正在缓冲视频到内存，这可能需要几十秒，请耐心等待...', 15000);
      
      // 在页面上下文中直接fetch，避免403
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const blob = await response.blob();
      
      // 检查是否是被防盗链拦截后返回的HTML页面
      if (blob.type.includes('text/html') || blob.size < 1000) {
        const text = await blob.text();
        if (text.includes('<!DOCTYPE') || text.includes('<html')) {
          throw new Error('被防盗链拦截');
        }
      }

      showToast('缓冲完成，正在保存文件...', 3000);

      // 直接在页面内通过Object URL下载，避免将几十MB的视频转为Base64导致扩展崩溃或卡死
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      // a.download 不支持子目录，所以将目录分隔符替换为下划线
      a.download = filename.replace(/\//g, '_'); 
      document.body.appendChild(a);
      a.click();
      a.remove();
      
      // 延迟释放，确保浏览器已经开始接收数据
      setTimeout(() => {
        URL.revokeObjectURL(objectUrl);
      }, 2000);
      
      return { success: true };
    } catch (error) {
      console.error('[抖音下载助手] 页面内Fetch失败:', error);
      showToast('缓冲失败，尝试后台下载...', 2000);
      // 如果页面内fetch失败，回退到原来的后台下载方式
      return new Promise((resolve) => {
        chrome.runtime.sendMessage({
          type: 'DOUDOU_DOWNLOAD_MEDIA',
          action: 'download',
          url: url,
          filename: filename
        }, (response) => {
          const err = chrome.runtime.lastError;
          if (err) {
            console.warn('[抖音下载助手] 后台下载响应异常:', err.message);
          }
          resolve(response);
        });
      });
    }
  }

  // ==================== 监听网络请求捕获视频URL ====================

  function isVideoUrl(url) {
    if (!url) return false;
    const lowerUrl = url.toLowerCase();
    
    const videoPatterns = [
      'douyinvod.com',
      'bytedance.com',
      'v26-web',
      'v27-web',
      'v28-web',
      'v29-web',
      'v30-web',
      '.mp4',
      '.m4s',
      'video_id=',
      'vid_',
      '/play/',
      'playaddr'
    ];
    
    for (const pattern of videoPatterns) {
      if (lowerUrl.includes(pattern)) return true;
    }
    
    return false;
  }

  // 拦截XHR和Fetch在content script中可能无法拦截主页面的请求
  // 因此我们通过注入 inject.js 到 main world 来处理 API 数据
  
  window.addEventListener('message', (event) => {
    if (event.data && (event.data.type === 'DOUDOU_DY_MEDIA_DATA' || event.data.type === 'DOUDOU_DY_NOTE_DATA')) {
      if (event.data.notes) {
        const notes = event.data.notes;
        for (const id in notes) {
          window.__dyNoteData[id] = notes[id];
          console.log('[豆豆] 通过API捕获到图文高清数据:', id, notes[id].length, '张图片');
        }
      }
      if (event.data.videos) {
        const videos = event.data.videos;
        for (const id in videos) {
          window.__dyVideoMap[id] = videos[id];
          console.log('[豆豆] 通过API捕获到视频播放地址:', id, videos[id]);
        }
      }
    }
  });

  // 拦截XHR获取视频URL
  function interceptXHR() {
    const XHR = XMLHttpRequest.prototype;
    const originalOpen = XHR.open;
    const originalSend = XHR.send;
    const originalSetRequestHeader = XHR.setRequestHeader;

    XHR.open = function(method, url) {
      this._url = url;
      this._method = method;
      this._headers = {};
      return originalOpen.apply(this, arguments);
    };

    XHR.setRequestHeader = function(name, value) {
      this._headers[name] = value;
      return originalSetRequestHeader.apply(this, arguments);
    };

    XHR.send = function() {
      const url = this._url;
      
      if (isVideoUrl(url)) {
        const videoData = {
          url: url,
          headers: this._headers || {},
          timestamp: Date.now()
        };
        
        if (!window.__dyVideoData.urls.find(u => u.url === url)) {
          window.__dyVideoData.urls.unshift(videoData);
          if (window.__dyVideoData.urls.length > 10) {
            window.__dyVideoData.urls.pop();
          }
        }
        window.__dyVideoData.currentUrl = url;
        window.__dyVideoData.headers = this._headers;
      }
      
      return originalSend.apply(this, arguments);
    };
  }

  // 拦截Fetch获取视频URL
  function interceptFetch() {
    const originalFetch = window.fetch;
    
    window.fetch = async function(url, options) {
      const urlString = typeof url === 'string' ? url : url.url || '';
      const headers = options?.headers || {};
      
      if (isVideoUrl(urlString)) {
        const videoData = {
          url: urlString,
          headers: headers,
          timestamp: Date.now()
        };
        
        if (!window.__dyVideoData.urls.find(u => u.url === urlString)) {
          window.__dyVideoData.urls.unshift(videoData);
          if (window.__dyVideoData.urls.length > 10) {
            window.__dyVideoData.urls.pop();
          }
        }
        window.__dyVideoData.currentUrl = urlString;
        window.__dyVideoData.headers = headers;
      }
      
      return originalFetch.apply(this, arguments);
    };
  }

  // 从video元素获取
  function getVideoFromElement() {
    const videos = document.querySelectorAll('video');
    for (const video of videos) {
      if (video.src && !video.src.startsWith('blob:')) {
        console.log('[抖音下载助手] video.src:', video.src);
        return video.src;
      }
      if (video.currentSrc && !video.currentSrc.startsWith('blob:')) {
        console.log('[抖音下载助手] video.currentSrc:', video.currentSrc);
        return video.currentSrc;
      }
    }
    return null;
  }

  // 通过 API 根据 aweme_id 主动查询作品详情 (图文 / 视频)
  async function fetchAwemeDetail(awemeId) {
    if (!awemeId) return null;
    
    // 只有在已经明确缓存了图文图片列表时才直接返回
    if (window.__dyNoteData[awemeId] && window.__dyNoteData[awemeId].length > 0) {
      return {
        isNote: true,
        note: window.__dyNoteData[awemeId],
        video: window.__dyVideoMap[awemeId]
      };
    }

    try {
      console.log('[豆豆] 正在根据 aweme_id 主动查询作品详情:', awemeId);
      const res = await fetch(`/aweme/v1/web/aweme/detail/?aweme_id=${awemeId}&device_platform=webapp`);
      if (!res.ok) return null;
      const data = await res.json();
      const aweme = data?.aweme_detail;
      if (!aweme) return null;

      // 1. 提取图文图片（覆盖各种节点）
      const rawImages = aweme.images || 
                        aweme.image_post_info?.images || 
                        aweme.image_post_info?.image_list ||
                        aweme.images_info ||
                        aweme.img_url_list ||
                        aweme.image_album;

      let noteImages = null;
      if (rawImages && Array.isArray(rawImages) && rawImages.length > 0) {
        const list = rawImages.map(img => {
          if (typeof img === 'string') return img;
          let url = img.urlList?.[0] || 
                    img.url_list?.[0] || 
                    img.display_image?.url_list?.[0] || 
                    img.display_image?.urlList?.[0] || 
                    img.owner_watermark_image?.url_list?.[0] || 
                    img.downloadUrlList?.[0] || 
                    img.download_url_list?.[0];
          if (url && url.startsWith('//')) url = 'https:' + url;
          return url;
        }).filter(Boolean);

        if (list.length > 0) {
          noteImages = list;
          window.__dyNoteData[awemeId] = list;
          console.log('[豆豆] API成功捕获图文图片:', awemeId, list.length, '张');
        }
      }

      // 2. 提取视频播放地址
      let videoUrl = null;
      if (aweme.video) {
        const video = aweme.video;
        const bitRateList = video.bitRateList || video.bit_rate_list;
        if (bitRateList && Array.isArray(bitRateList) && bitRateList.length > 0) {
          const sorted = [...bitRateList].sort((a, b) => (b.bit_rate || 0) - (a.bit_rate || 0));
          for (const item of sorted) {
            videoUrl = item.playAddr?.[0]?.src || item.play_addr?.url_list?.[0] || item.playAddrH265?.[0]?.src;
            if (videoUrl) break;
          }
        }
        if (!videoUrl) {
          videoUrl = video.playAddr?.[0]?.src || 
                     video.playAddrH265?.[0]?.src || 
                     video.play_addr?.url_list?.[0] || 
                     video.download_addr?.url_list?.[0];
        }
        if (videoUrl) {
          if (videoUrl.startsWith('//')) videoUrl = 'https:' + videoUrl;
          videoUrl = videoUrl.replace(/playwm/g, 'play').replace(/&watermark=1/g, '');
          window.__dyVideoMap[awemeId] = videoUrl;
        }
      }

      return {
        isNote: !!(noteImages && noteImages.length > 0),
        note: noteImages,
        video: videoUrl
      };
    } catch (e) {
      console.error('[豆豆] 主动 API 查询作品详情失败:', e);
    }
    return null;
  }

  // 获取最新的视频URL
  async function getLatestVideoUrl() {
    const currentAwemeId = getCurrentAwemeId();
    
    // 优先 1：如果是当前 ID 且有已捕获的视频 URL
    if (currentAwemeId && window.__dyVideoMap[currentAwemeId]) {
      return window.__dyVideoMap[currentAwemeId];
    }
    
    // 优先 2：使用当前拦截到的最新视频请求 URL
    if (window.__dyVideoData.currentUrl) {
      return window.__dyVideoData.currentUrl;
    }
    
    // 优先 3：从列表获取最新的
    if (window.__dyVideoData.urls.length > 0) {
      return window.__dyVideoData.urls[0].url;
    }
    
    // 优先 4：从 video 元素获取
    const elUrl = getVideoFromElement();
    if (elUrl) return elUrl;

    // 优先 5：如果属于特定 modal_id 视频，主动向页面 API 请求获取
    if (currentAwemeId) {
      const detail = await fetchAwemeDetail(currentAwemeId);
      if (detail?.video) return detail.video;
    }
    
    return null;
  }

  // ==================== 从RENDER_DATA解析 ====================

  function getVideoFromRenderData() {
    try {
      const renderDataScript = document.querySelector('#RENDER_DATA');
      if (!renderDataScript) return null;

      const data = JSON.parse(decodeURIComponent(renderDataScript.textContent));
      console.log('[抖音下载助手] RENDER_DATA keys:', Object.keys(data));

      const appData = data.app;
      if (!appData) return null;

      // 尝试多种路径
      const paths = [
        () => appData.videoDetail,
        () => appData.videoData,
        () => appData.aweme?.detail,
        () => appData.awemeDetail,
      ];

      for (const getPath of paths) {
        const detail = getPath();
        if (detail) {
          const video = detail.video;
          
          // 优先寻找最高画质 (bitRateList 或 bit_rate_list)
          const bitRateList = video?.bitRateList || video?.bit_rate_list;
          if (bitRateList && bitRateList.length > 0) {
            // 按 bit_rate 降序排序
            const sortedList = [...bitRateList].sort((a, b) => (b.bit_rate || 0) - (a.bit_rate || 0));
            for (const item of sortedList) {
              const url = item.playAddr?.[0]?.src || item.play_addr?.url_list?.[0];
              if (url) return url;
            }
          }
          
          // 新版数据结构兜底
          if (video?.playAddr?.length > 0 && video.playAddr[0].src) {
            return video.playAddr[0].src;
          }
          if (video?.playAddrH265?.length > 0 && video.playAddrH265[0].src) {
            return video.playAddrH265[0].src;
          }
          
          // 旧版数据结构
          if (video?.play_addr?.url_list?.length > 0) {
            return video.play_addr.url_list[0];
          }
          if (video?.download_addr?.url_list?.length > 0) {
            return video.download_addr.url_list[0];
          }
          
          // 检查图片
          if (detail.images && detail.images.length > 0) {
            return {
              images: detail.images.map(img => img.url_list?.[0]).filter(Boolean)
            };
          }
        }
      }
    } catch (e) {
      console.error('[抖音下载助手] 解析RENDER_DATA失败:', e);
    }
    return null;
  }

  // ==================== 主下载函数 ====================

  let isDownloading = false;

  // 内部无锁视频下载逻辑
  async function doDownloadVideo(btn, presetUrl = null) {
    let videoUrl = presetUrl || await getLatestVideoUrl();

    // 备用：从RENDER_DATA获取
    if (!videoUrl) {
      const renderDataResult = getVideoFromRenderData();
      if (typeof renderDataResult === 'string') {
        videoUrl = renderDataResult;
      } else if (renderDataResult?.images?.length > 0) {
        await doDownloadImages(renderDataResult.images, btn);
        return;
      }
    }

    if (!videoUrl) {
      showToast('未找到视频，请先播放视频');
      setButtonState(btn, 'error');
      return;
    }

    showToast('开始下载视频...');
    
    // 处理URL
    if (videoUrl.startsWith('//')) {
      videoUrl = 'https:' + videoUrl;
    }
    
    // 移除水印参数
    videoUrl = videoUrl.replace(/playwm/g, 'play').replace(/&watermark=1/g, '');
    
    console.log('[抖音下载助手] 下载URL:', videoUrl);
    
    const filename = `douyin_video/${Date.now()}.mp4`;
    const result = await downloadDirectUrl(videoUrl, filename);
    
    if (result && result.success) {
      showToast('视频下载成功！');
      setButtonState(btn, 'success');
    } else {
      showToast('下载失败: ' + (result?.error || '请重试'));
      setButtonState(btn, 'error');
    }
  }

  // 内部无锁图片下载逻辑
  async function doDownloadImages(images, btn) {
    showToast(`开始下载 ${images.length} 张图片...`);
    
    const progress = createProgress('下载图片');
    const timestamp = Date.now();
    let success = 0;

    for (let i = 0; i < images.length; i++) {
      progress.update(i + 1, images.length, `下载第 ${i + 1} 张`);
      
      let imgUrl = images[i];
      if (imgUrl.startsWith('//')) {
        imgUrl = 'https:' + imgUrl;
      }
      
      const ext = imgUrl.includes('.png') ? 'png' : 'jpg';
      const filename = `douyin_images/${timestamp}_${String(i + 1).padStart(2, '0')}.${ext}`;
      
      const result = await downloadImageFile(imgUrl, filename);
      if (result && result.success) success++;
      
      await new Promise(r => setTimeout(r, 300));
    }

    progress.close();
    showToast(`成功下载 ${success}/${images.length} 张`);
    setButtonState(btn, success > 0 ? 'success' : 'error');
  }

  // 外部调用视频下载入口
  async function downloadVideo(btn) {
    if (isDownloading) {
      showToast('正在下载中，请勿重复点击');
      return;
    }
    isDownloading = true;
    setButtonState(btn, 'loading');

    try {
      await doDownloadVideo(btn);
    } catch (error) {
      showToast('下载失败: ' + error.message);
      setButtonState(btn, 'error');
    } finally {
      isDownloading = false;
    }
  }

  // 外部调用图片下载入口
  async function downloadImages(images, btn) {
    if (isDownloading) {
      showToast('正在下载中，请勿重复点击');
      return;
    }
    isDownloading = true;
    setButtonState(btn, 'loading');

    try {
      await doDownloadImages(images, btn);
    } catch (error) {
      showToast('下载失败: ' + error.message);
      setButtonState(btn, 'error');
    } finally {
      isDownloading = false;
    }
  }

  // ==================== 提取页面图片 ====================

  function getCurrentAwemeId() {
    const urlParams = new URLSearchParams(window.location.search);
    let id = urlParams.get('modal_id');
    if (id) return id;

    const match = window.location.pathname.match(/\/(video|note)\/(\d+)/);
    if (match) return match[2];

    return null;
  }

  function parseRenderDataForImages() {
    try {
      const renderDataScript = document.querySelector('#RENDER_DATA');
      if (!renderDataScript) return;

      const data = JSON.parse(decodeURIComponent(renderDataScript.textContent));
      
      const visited = new WeakSet();
      function traverse(obj, depth = 0) {
        if (!obj || typeof obj !== 'object' || depth > 15) return;
        if (visited.has(obj)) return;
        visited.add(obj);

        const awemeId = obj.aweme_id || obj.awemeId;
        const rawImages = obj.images || obj.image_post_info?.images;
        if (awemeId && rawImages && Array.isArray(rawImages) && rawImages.length > 0) {
          window.__dyNoteData[awemeId] = rawImages.map(img => {
            return img.urlList?.[0] || 
                   img.url_list?.[0] || 
                   img.display_image?.url_list?.[0] || 
                   img.display_image?.urlList?.[0] || 
                   img.downloadUrlList?.[0] || 
                   img.download_url_list?.[0];
          }).filter(Boolean);
          console.log('[豆豆] 从RENDER_DATA捕获到图文高清数据:', awemeId);
        }
        for (const key in obj) {
          if (Object.prototype.hasOwnProperty.call(obj, key)) traverse(obj[key], depth + 1);
        }
      }
      traverse(data);
    } catch(e) {
      console.error('[豆豆] 解析RENDER_DATA失败:', e);
    }
  }

  // 从 DOM 中精准提取图文作品大图（严格限定图文专有容器，绝不泛搜全局，防止将视频封面误判为图片）
  function getImagesFromDOM() {
    const imgSet = new Set();

    // 严格限定图文大图专属容器
    const containerSelectors = [
      '[data-e2e="note-detail-image"] img',
      'div[class*="note-detail"] img',
      'div[class*="NoteDetail"] img',
      '.note-detail-container img'
    ];

    let targetImgs = [];
    for (const sel of containerSelectors) {
      const found = document.querySelectorAll(sel);
      if (found && found.length > 0) {
        targetImgs = Array.from(found);
        break;
      }
    }

    targetImgs.forEach(img => {
      let src = img.src || img.getAttribute('data-src');
      if (src) {
        const lower = src.toLowerCase();
        if (lower.includes('avatar') || 
            lower.includes('icon') || 
            lower.includes('profile') || 
            lower.includes('emoji') || 
            lower.includes('emotion') || 
            lower.includes('sticker')) {
          return;
        }

        if (img.naturalWidth > 0 && (img.naturalWidth < 250 || img.naturalHeight < 250)) {
          return;
        }

        if (src.startsWith('//')) src = 'https:' + src;
        imgSet.add(src);
      }
    });

    return Array.from(imgSet);
  }

  // 判断当前页面是否为独立的视频/作品主页面
  function isStandaloneMediaPage() {
    const pathname = location.pathname;
    
    // 常见的非独立搜索/频道列表路径 (注：/jingxuan 已经被指定为目标播放页)
    const nonStandalonePaths = [
      '/search',
      '/user',
      '/channel',
      '/discover',
      '/vs',
      '/challenge',
      '/music',
      '/collection'
    ];

    for (const p of nonStandalonePaths) {
      if (pathname.includes(p)) {
        return false;
      }
    }

    return true;
  }

  // 打开独立的视频/作品主页面并标记自动触发下载
  function openStandaloneMediaPage(awemeId) {
    const targetUrl = `https://www.douyin.com/jingxuan?modal_id=${awemeId}&doudou_auto_download=1`;
    showToast('当前非独立播放页，正在打开独立页并自动下载...', 3000);
    try {
      chrome.runtime.sendMessage({ type: "OPEN_TAB", url: targetUrl }, (res) => {
        const err = chrome.runtime.lastError;
        if (err) {
          window.open(targetUrl, '_blank');
        }
      });
    } catch (e) {
      window.open(targetUrl, '_blank');
    }
  }

  // 跨页自动触发下载校验器
  function checkAutoDownload() {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('doudou_auto_download') === '1') {
      try {
        const cleanUrl = new URL(window.location.href);
        cleanUrl.searchParams.delete('doudou_auto_download');
        window.history.replaceState({}, '', cleanUrl.toString());
      } catch (e) {}

      showToast('精选播放页就绪，即将自动开始下载...', 3000);

      setTimeout(() => {
        // 传入 forceDirect = true 强行开启底层下载，避开二次重定向
        handleDownloadMediaAction(null, true);
      }, 1500);
    }
  }

  async function handleDownloadMediaAction(btn, forceDirect = false) {
    const currentAwemeId = getCurrentAwemeId();

    // 如果不是独立的作品播放页面，且非强行触发状态，打开独立的页面进行下载
    if (!forceDirect && !isStandaloneMediaPage() && currentAwemeId) {
      openStandaloneMediaPage(currentAwemeId);
      return;
    }

    if (isDownloading) {
      showToast('正在下载中，请勿重复点击');
      return;
    }
    isDownloading = true;
    setButtonState(btn, 'loading');

    try {
      parseRenderDataForImages();

      // 优先 1：参考项目的 DOM 提取逻辑 (.focusPanel / .dySwiperSlide / aweme_images)
      const domRefImages = extractImagesFromReferenceDOM();
      if (domRefImages && domRefImages.length > 0) {
        console.log('[豆豆] 从 DOM 成功提取到图集图片:', domRefImages.length, '张');
        await doDownloadImages(domRefImages, btn);
        return;
      }

      // 优先 2：当前是否有已拦截的图文高清数据
      if (currentAwemeId && window.__dyNoteData[currentAwemeId] && window.__dyNoteData[currentAwemeId].length > 0) {
        await doDownloadImages(window.__dyNoteData[currentAwemeId], btn);
        return;
      }

      // 优先 3：如果有 currentAwemeId，通过 API 权威校验作品类型（图文 OR 视频）
      if (currentAwemeId) {
        const detail = await fetchAwemeDetail(currentAwemeId);
        if (detail) {
          if (detail.isNote && detail.note?.length > 0) {
            await doDownloadImages(detail.note, btn);
            return;
          }
          if (detail.video) {
            await doDownloadVideo(btn, detail.video);
            return;
          }
        }
      }

      // 优先 4：静态渲染数据
      const renderDataResult = getVideoFromRenderData();
      if (renderDataResult?.images?.length > 0) {
        await doDownloadImages(renderDataResult.images, btn);
        return;
      }

      // 优先 5：视频下载逻辑
      await doDownloadVideo(btn);
    } catch (e) {
      console.error('[豆豆] 下载处理异常:', e);
      showToast('下载处理失败: ' + e.message);
      setButtonState(btn, 'error');
    } finally {
      isDownloading = false;
    }
  }

  // ==================== 初始化 ====================

  function init() {
    if (!location.hostname.includes('douyin.com')) return;
    
    // 注入 API 拦截脚本到 main world
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('src/douyin/inject.js');
    (document.head || document.documentElement).appendChild(script);

    // 监听来自background或popup的消息
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === 'downloadDouyinMediaAction') {
        handleDownloadMediaAction(null);
        sendResponse({ success: true });
      }
      return true;
    });

    // 监听来自网页悬浮按钮的事件
    window.addEventListener('DOUDOU_TRIGGER_MEDIA_DOWNLOAD', () => {
      handleDownloadMediaAction(null);
    });
    
    // 启动请求拦截（尽早执行）
    interceptXHR();
    interceptFetch();
    
    // 监听URL变化，清空旧的视频地址缓存
    let lastUrl = location.href;
    new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        window.__dyVideoData.currentUrl = null; // 清空缓存
      }
    }).observe(document.documentElement, { childList: true, subtree: true });

    // 检查并触发跨页自动下载
    checkAutoDownload();
  }

  init();
  console.log('[豆豆] 抖音视频下载助手已注入');

})();
