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

  // ==================== 工具函数 ====================

  function showToast(message, duration = 3000) {
    const existing = document.querySelector('.douyin-downloader-toast');
    if (existing) existing.remove();
    
    const toast = document.createElement('div');
    toast.className = 'douyin-downloader-toast';
    toast.textContent = message;
    document.body.appendChild(toast);
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
    document.body.appendChild(progress);
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
          action: 'download',
          url: url,
          filename: filename
        }, (response) => {
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
  // 因此我们通过注入 douyin-inject.js 到 main world 来处理 API 数据
  
  window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'DOUDOU_DY_NOTE_DATA') {
      const notes = event.data.notes;
      for (const id in notes) {
        window.__dyNoteData[id] = notes[id];
        console.log('[豆豆] 通过API捕获到图文高清数据:', id, notes[id].length, '张图片');
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

  // 获取最新的视频URL
  function getLatestVideoUrl() {
    // 优先使用当前URL
    if (window.__dyVideoData.currentUrl) {
      return window.__dyVideoData.currentUrl;
    }
    
    // 从列表获取最新的
    if (window.__dyVideoData.urls.length > 0) {
      return window.__dyVideoData.urls[0].url;
    }
    
    // 从video元素获取
    return getVideoFromElement();
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

  async function downloadVideo(btn) {
    if (isDownloading) {
      showToast('正在下载中，请勿重复点击');
      return;
    }
    isDownloading = true;
    setButtonState(btn, 'loading');

    try {
      let videoUrl = getLatestVideoUrl();
    
      // 备用：从RENDER_DATA获取
      if (!videoUrl) {
        const renderDataResult = getVideoFromRenderData();
        if (typeof renderDataResult === 'string') {
          videoUrl = renderDataResult;
        } else if (renderDataResult?.images?.length > 0) {
          // 是图集
          await downloadImages(renderDataResult.images, btn);
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
    } catch (error) {
      showToast('下载失败: ' + error.message);
      setButtonState(btn, 'error');
    } finally {
      isDownloading = false;
    }
  }

  // 下载图片
  async function downloadImages(images, btn) {
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
      
      const result = await downloadDirectUrl(imgUrl, filename);
      if (result && result.success) success++;
      
      await new Promise(r => setTimeout(r, 300));
    }

    progress.close();
    showToast(`成功下载 ${success}/${images.length} 张`);
    setButtonState(btn, success > 0 ? 'success' : 'error');
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
      
      function traverse(obj) {
        if (!obj || typeof obj !== 'object') return;
        const awemeId = obj.aweme_id || obj.awemeId;
        if (awemeId && obj.images && Array.isArray(obj.images) && obj.images.length > 0) {
          window.__dyNoteData[awemeId] = obj.images.map(img => {
            return img.urlList?.[0] || img.url_list?.[0] || img.downloadUrlList?.[0] || img.download_url_list?.[0];
          }).filter(Boolean);
          console.log('[豆豆] 从RENDER_DATA捕获到图文高清数据:', awemeId);
        }
        for (const key in obj) {
          if (obj.hasOwnProperty(key)) traverse(obj[key]);
        }
      }
      traverse(data);
    } catch(e) {
      console.error('[豆豆] 解析RENDER_DATA失败:', e);
    }
  }

  async function handleDownloadMediaAction(btn) {
    if (isDownloading) {
      showToast('正在下载中，请勿重复点击');
      return;
    }

    // 主动解析一次页面初始数据，以防没有触发过API
    parseRenderDataForImages();

    const currentAwemeId = getCurrentAwemeId();
    // 优先判断：当前是否有图文的高清数据
    if (currentAwemeId && window.__dyNoteData[currentAwemeId] && window.__dyNoteData[currentAwemeId].length > 0) {
      const images = window.__dyNoteData[currentAwemeId];
      isDownloading = true;
      setButtonState(btn, 'loading');
      try {
        await downloadImages(images, btn);
      } finally {
        isDownloading = false;
      }
      return;
    }

    // 次优先：看看渲染数据里直接能否提取出图集
    const renderDataResult = getVideoFromRenderData();
    if (renderDataResult?.images?.length > 0) {
      isDownloading = true;
      setButtonState(btn, 'loading');
      try {
        await downloadImages(renderDataResult.images, btn);
      } finally {
        isDownloading = false;
      }
      return;
    }

    // 如果以上都不是图文，说明是视频，走视频下载逻辑
    downloadVideo(btn);
  }

  // ==================== 初始化 ====================

  function init() {
    if (!location.hostname.includes('douyin.com')) return;
    
    // 注入 API 拦截脚本到 main world
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('src/douyin-inject.js');
    (document.head || document.documentElement).appendChild(script);

    // 监听来自background或popup的消息
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === 'downloadDouyinMediaAction') {
        handleDownloadMediaAction(null);
        sendResponse({ success: true });
      }
      return true;
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
  }

  init();
  console.log('[豆豆] 抖音视频下载助手已注入');

})();
