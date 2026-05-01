chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "OFFSCREEN_PING") {
    sendResponse({ pong: true });
    return false;
  }
  if (message.type === "OFFSCREEN_FETCH") {
    handleFetch(message.payload).then((result) => sendResponse({ success: true, data: result })).catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }
  if (message.type === "OFFSCREEN_WARM_FETCH") {
    handleWarmFetch(message.payload).then((result) => sendResponse({ success: true, data: result })).catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }
  if (message.type === "OFFSCREEN_API_FETCH") {
    handleApiFetch(message.payload).then((result) => sendResponse({ success: true, data: result })).catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }
  if (message.type === "OFFSCREEN_DETECT_CTO51") {
    handleDetectCto51().then((result) => sendResponse({ success: true, data: result })).catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }
  if (message.type === "OFFSCREEN_DETECT_CNBLOGS") {
    handleDetectCnblogs().then((result) => sendResponse({ success: true, data: result })).catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }
  if (message.type === "OFFSCREEN_DETECT_XIAOHONGSHU") {
    handleDetectXiaohongshu().then((result) => sendResponse({ success: true, data: result })).catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }
});
async function handleFetch(payload) {
  const { url, method, headers, body } = payload;
  const resp = await fetch(url, {
    method: method || "POST",
    credentials: "include",
    headers: headers || {},
    body: body ? JSON.stringify(body) : void 0
  });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}`);
  }
  return await resp.json();
}
async function handleWarmFetch(payload) {
  const { url, redirect } = payload;
  try {
    const resp = await fetch(url, {
      method: "GET",
      credentials: "include",
      redirect: redirect || "follow"
    });
    const text = await resp.text();
    return {
      status: resp.status,
      url: resp.url,
      length: text.length
    };
  } catch (e) {
    return { error: e.message };
  }
}
async function handleApiFetch(payload) {
  const { url, method, headers, responseType, redirect } = payload;
  try {
    const resp = await fetch(url, {
      method: method || "GET",
      credentials: "include",
      headers: headers || {},
      redirect: redirect || "follow"
    });
    const status = resp.status;
    const finalUrl = resp.url;
    let body = null;
    if (responseType === "json") {
      try {
        body = await resp.json();
      } catch (e) {
        body = null;
      }
    } else {
      body = await resp.text();
    }
    return { status, url: finalUrl, body };
  } catch (e) {
    return { error: e.message };
  }
}
async function handleDetectCto51() {
  var _a;
  try {
    const resp = await fetch("https://home.51cto.com/space", {
      credentials: "include"
    });
    const html = await resp.text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    const avatarEl = doc.querySelector("img[alt='头像']");
    const avatar = avatarEl ? avatarEl.getAttribute("src") : "";
    let uid = "";
    if (avatar) {
      const m = avatar.match(/uid=(\d+)/);
      if (m) uid = m[1];
    }
    const nameEl = doc.querySelector("div.name > a");
    const username = nameEl ? nameEl.textContent.trim() : "";
    if (!username && !uid) {
      const title = ((_a = doc.querySelector("title")) == null ? void 0 : _a.textContent) || "";
      return { loggedIn: false, _debug: { status: resp.status, url: resp.url, htmlLen: html.length, title } };
    }
    return { loggedIn: true, username, avatar, uid };
  } catch (e) {
    return { loggedIn: false, error: e.message };
  }
}
async function handleDetectCnblogs() {
  try {
    const resp = await fetch("https://account.cnblogs.com/user/userinfo", {
      method: "GET",
      credentials: "include",
      headers: { "Accept": "application/json" }
    });
    if (!resp.ok) return { loggedIn: false };
    const data = await resp.json();
    if (!(data == null ? void 0 : data.spaceUserId)) return { loggedIn: false };
    const username = data.displayName || "";
    let avatar = data.iconName || "";
    if (avatar && !avatar.startsWith("http")) {
      avatar = "https:" + avatar;
    }
    return { loggedIn: true, username, avatar };
  } catch (e) {
    return { loggedIn: false, error: e.message };
  }
}
async function handleDetectXiaohongshu() {
  var _a;
  try {
    const resp = await fetch("https://creator.xiaohongshu.com/api/galaxy/user/info", {
      method: "GET",
      credentials: "include",
      headers: { "Accept": "application/json" }
    });
    if (!resp.ok) return { loggedIn: false };
    const data = await resp.json();
    if ((data == null ? void 0 : data.success) === true && (data == null ? void 0 : data.code) === 0 && ((_a = data == null ? void 0 : data.data) == null ? void 0 : _a.userId)) {
      return {
        loggedIn: true,
        username: data.data.userName || data.data.redId || "",
        avatar: data.data.userAvatar || "",
        userId: data.data.userId
      };
    }
    return { loggedIn: false };
  } catch (e) {
    return { loggedIn: false, error: e.message };
  }
}
