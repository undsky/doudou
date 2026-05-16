(function() {
  if (window.__doudouDyInjected) return;
  window.__doudouDyInjected = true;

  const originalFetch = window.fetch;
  window.fetch = async function(url, options) {
    const urlString = typeof url === 'string' ? url : url?.url || '';
    const promise = originalFetch.apply(this, arguments);
    
    promise.then(response => {
      if (urlString.includes('/aweme/v1/web/aweme/') || 
          urlString.includes('/aweme/v1/web/tab/feed/') || 
          urlString.includes('/search/single/')) {
        response.clone().json().then(data => {
          if (!data) return;
          const awemeList = [];
          if (data.aweme_detail) awemeList.push(data.aweme_detail);
          if (data.aweme_list) awemeList.push(...data.aweme_list);
          if (data.data) {
              const items = Array.isArray(data.data) ? data.data : [data.data];
              items.forEach(item => {
                  if (item.aweme_info) awemeList.push(item.aweme_info);
              });
          }

          const notes = {};
          let found = false;
          awemeList.forEach(aweme => {
            const id = aweme.aweme_id || aweme.awemeId;
            if (id && aweme.images && Array.isArray(aweme.images) && aweme.images.length > 0) {
              notes[id] = aweme.images.map(img => {
                return img.urlList?.[0] || img.url_list?.[0] || img.downloadUrlList?.[0] || img.download_url_list?.[0];
              }).filter(Boolean);
              found = true;
            }
          });

          if (found) {
            window.postMessage({ type: 'DOUDOU_DY_NOTE_DATA', notes }, '*');
          }
        }).catch(() => {});
      }
    }).catch(() => {});

    return promise;
  };

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
      if (urlString.includes('/aweme/v1/web/aweme/') || 
          urlString.includes('/aweme/v1/web/tab/feed/') || 
          urlString.includes('/search/single/')) {
        try {
          const data = JSON.parse(this.responseText);
          if (!data) return;
          const awemeList = [];
          if (data.aweme_detail) awemeList.push(data.aweme_detail);
          if (data.aweme_list) awemeList.push(...data.aweme_list);
          if (data.data) {
              const items = Array.isArray(data.data) ? data.data : [data.data];
              items.forEach(item => {
                  if (item.aweme_info) awemeList.push(item.aweme_info);
              });
          }

          const notes = {};
          let found = false;
          awemeList.forEach(aweme => {
            const id = aweme.aweme_id || aweme.awemeId;
            if (id && aweme.images && Array.isArray(aweme.images) && aweme.images.length > 0) {
              notes[id] = aweme.images.map(img => {
                return img.urlList?.[0] || img.url_list?.[0] || img.downloadUrlList?.[0] || img.download_url_list?.[0];
              }).filter(Boolean);
              found = true;
            }
          });

          if (found) {
            window.postMessage({ type: 'DOUDOU_DY_NOTE_DATA', notes }, '*');
          }
        } catch(e) {}
      }
    });
    return originalSend.apply(this, arguments);
  };
})();
