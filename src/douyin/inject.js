(function() {
  if (window.__doudouDyInjected) return;
  window.__doudouDyInjected = true;

  function extractImageUrls(imgObj) {
    if (!imgObj) return null;
    if (typeof imgObj === 'string') return imgObj;
    let url = imgObj.urlList?.[0] || 
              imgObj.url_list?.[0] || 
              imgObj.display_image?.url_list?.[0] || 
              imgObj.display_image?.urlList?.[0] || 
              imgObj.owner_watermark_image?.url_list?.[0] || 
              imgObj.downloadUrlList?.[0] || 
              imgObj.download_url_list?.[0];
    
    if (url && url.startsWith('//')) {
      url = 'https:' + url;
    }
    return url;
  }

  function parseAweme(aweme, notes, videos) {
    if (!aweme || typeof aweme !== 'object') return;
    const id = aweme.aweme_id || aweme.awemeId;
    if (!id) return;

    // 1. 提取图文高清图片（覆盖所有可能的API节点结构）
    const rawImages = aweme.images || 
                      aweme.image_post_info?.images || 
                      aweme.image_post_info?.image_list ||
                      aweme.images_info ||
                      aweme.img_url_list ||
                      aweme.image_album;
                      
    if (rawImages && Array.isArray(rawImages) && rawImages.length > 0) {
      const list = rawImages.map(img => extractImageUrls(img)).filter(Boolean);
      if (list.length > 0) {
        notes[id] = list;
      }
    }

    // 2. 提取最高画质视频播放地址
    if (aweme.video) {
      const video = aweme.video;
      let url = null;
      const bitRateList = video.bitRateList || video.bit_rate_list;
      if (bitRateList && Array.isArray(bitRateList) && bitRateList.length > 0) {
        const sorted = [...bitRateList].sort((a, b) => (b.bit_rate || 0) - (a.bit_rate || 0));
        for (const item of sorted) {
          url = item.playAddr?.[0]?.src || item.play_addr?.url_list?.[0] || item.playAddrH265?.[0]?.src;
          if (url) break;
        }
      }
      if (!url) {
        url = video.playAddr?.[0]?.src || 
              video.playAddrH265?.[0]?.src || 
              video.play_addr?.url_list?.[0] || 
              video.download_addr?.url_list?.[0];
      }
      if (url) {
        if (url.startsWith('//')) url = 'https:' + url;
        url = url.replace(/playwm/g, 'play').replace(/&watermark=1/g, '');
        videos[id] = url;
      }
    }
  }

  function processApiResponse(urlString, data) {
    if (!data) return;
    const awemeList = [];
    if (data.aweme_detail) awemeList.push(data.aweme_detail);
    if (data.aweme_list) awemeList.push(...data.aweme_list);
    if (data.data) {
      const items = Array.isArray(data.data) ? data.data : [data.data];
      items.forEach(item => {
        if (item.aweme_info) awemeList.push(item.aweme_info);
        if (item.aweme_detail) awemeList.push(item.aweme_detail);
        if (item.aweme) awemeList.push(item.aweme);
      });
    }

    const notes = {};
    const videos = {};
    awemeList.forEach(aweme => parseAweme(aweme, notes, videos));

    if (Object.keys(notes).length > 0 || Object.keys(videos).length > 0) {
      window.postMessage({ type: 'DOUDOU_DY_MEDIA_DATA', notes, videos }, '*');
    }
  }

  function isTargetApi(urlString) {
    if (!urlString) return false;
    return urlString.includes('/aweme/') ||
           urlString.includes('/search/') ||
           urlString.includes('/feed/') ||
           urlString.includes('/jingxuan/');
  }

  // 拦截 Fetch
  const originalFetch = window.fetch;
  window.fetch = async function(url, options) {
    const urlString = typeof url === 'string' ? url : url?.url || '';
    const promise = originalFetch.apply(this, arguments);
    
    if (isTargetApi(urlString)) {
      promise.then(response => {
        response.clone().json().then(data => {
          processApiResponse(urlString, data);
        }).catch(() => {});
      }).catch(() => {});
    }

    return promise;
  };

  // 拦截 XHR
  const XHR = XMLHttpRequest.prototype;
  const originalOpen = XHR.open;
  const originalSend = XHR.send;

  XHR.open = function(method, url) {
    this._url = url;
    return originalOpen.apply(this, arguments);
  };

  XHR.send = function() {
    this.addEventListener('load', function() {
      const urlString = typeof this._url === 'string' ? this._url : this._url?.url || '';
      if (isTargetApi(urlString)) {
        try {
          const data = JSON.parse(this.responseText);
          processApiResponse(urlString, data);
        } catch(e) {}
      }
    });
    return originalSend.apply(this, arguments);
  };
})();
