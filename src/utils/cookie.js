/**
 * Cookie Utilities for Doudou Extension
 * 用于获取和处理当前页面的 Cookie
 */

/**
 * 从 chrome.cookies API 获取到的 cookie 转换为 Netscape 格式字符串
 * Netscape Cookie File 格式:
 * domain	hostOnly	path	secure	expiry	name	value
 *
 * @param {chrome.cookies.Cookie} cookie - Chrome Cookie 对象
 * @returns {string} Netscape 格式的 cookie 行
 */
export function cookieToNetscapeFormat(cookie) {
  // domain: 如果是 hostOnly，domain 直接使用；否则添加 . 前缀
  const domain = cookie.hostOnly ? cookie.domain : cookie.domain;

  // hostOnly: TRUE 表示不是域名级别的 cookie, FALSE 表示是域名级别的 cookie
  const hostOnly = cookie.hostOnly ? "FALSE" : "TRUE";

  // path: cookie 的路径
  const path = cookie.path;

  // secure: 是否只在 HTTPS 中发送
  const secure = cookie.secure ? "TRUE" : "FALSE";

  // expiry: 过期时间 (Unix 时间戳)，session cookie 为 0
  const expiry = cookie.expirationDate
    ? Math.floor(cookie.expirationDate)
    : 0;

  // name 和 value
  const name = cookie.name;
  const value = cookie.value;

  return `${domain}\t${hostOnly}\t${path}\t${secure}\t${expiry}\t${name}\t${value}`;
}

/**
 * 将 cookie 数组转换为 Netscape Cookie File 格式的完整字符串
 * @param {Array<chrome.cookies.Cookie>} cookies - Chrome Cookie 对象数组
 * @returns {string} Netscape 格式的 cookie 文件内容
 */
export function cookiesToNetscapeFile(cookies) {
  const header = [
    "# Netscape HTTP Cookie File",
    "# http://curl.haxx.se/rfc/cookie_spec.html",
    "# This is a generated file!  Do not edit.",
    "",
  ].join("\n");

  const cookieLines = cookies.map(cookieToNetscapeFormat).join("\n");

  return header + cookieLines;
}

/**
 * 将 cookie 数组转换为简单的对象格式 (name-value pairs)
 * @param {Array<chrome.cookies.Cookie>} cookies - Chrome Cookie 对象数组
 * @returns {Object} 简单的对象格式 {name: value, ...}
 */
export function cookiesToObject(cookies) {
  const result = {};
  cookies.forEach((cookie) => {
    result[cookie.name] = cookie.value;
  });
  return result;
}

/**
 * 将 cookie 数组转换为 Cookie Header 格式的字符串
 * @param {Array<chrome.cookies.Cookie>} cookies - Chrome Cookie 对象数组
 * @returns {string} Cookie Header 格式字符串，例如 "name1=value1; name2=value2"
 */
export function cookiesToHeaderString(cookies) {
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

/**
 * 将 cookie 数组转换为详细的对象数组格式
 * @param {Array<chrome.cookies.Cookie>} cookies - Chrome Cookie 对象数组
 * @returns {Array<Object>} 详细的 cookie 对象数组
 */
export function cookiesToDetailedArray(cookies) {
  return cookies.map((cookie) => ({
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    sameSite: cookie.sameSite,
    expirationDate: cookie.expirationDate,
    hostOnly: cookie.hostOnly,
    session: cookie.session,
  }));
}
