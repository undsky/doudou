/**
 * TurndownService 通用规则
 * 为 TurndownService 实例添加统一的 Markdown 转换规则
 *
 * 使用方式：
 * 1. ES Module: import { addTurndownRules } from '../utils/turndown-rules.js';
 * 2. 页面注入: chrome.scripting.executeScript({ files: ['src/utils/turndown-rules.js'] });
 *    注入后通过全局函数 addTurndownRules(parser) 调用
 */

function addTurndownRules(parser) {
  // 清理链接格式
  parser.addRule('cleanLinks', {
    filter: 'a',
    replacement: function (content, node) {
      var href = node.getAttribute('href');
      var title = node.title ? ' "' + node.title + '"' : '';
      if (!href) return content;
      var cleanContent = content.replace(/\s+/g, ' ').trim();
      return '[' + cleanContent + '](' + href + title + ')';
    }
  });

  // 表格：单元格
  parser.addRule('tableCell', {
    filter: ['th', 'td'],
    replacement: function (content) {
      return ' ' + content.replace(/\n/g, ' ').trim() + ' |';
    }
  });

  // 表格：行（thead 中的行或无 thead 时的第一行自动添加分隔线）
  parser.addRule('tableRow', {
    filter: 'tr',
    replacement: function (content, node) {
      var result = '|' + content + '\n';
      var isHeader = node.parentNode.nodeName === 'THEAD' ||
        (node.parentNode.nodeName === 'TBODY' &&
          node === node.parentNode.firstElementChild &&
          !node.closest('table').querySelector('thead'));
      if (isHeader) {
        var cells = node.querySelectorAll('th, td');
        result += '|';
        for (var i = 0; i < cells.length; i++) {
          result += ' --- |';
        }
        result += '\n';
      }
      return result;
    }
  });

  // 表格：table 标签前后加空行
  parser.addRule('table', {
    filter: 'table',
    replacement: function (content) {
      return '\n\n' + content.trim() + '\n\n';
    }
  });

  // 表格：thead/tbody/tfoot 透传内容
  parser.addRule('tableSection', {
    filter: ['thead', 'tbody', 'tfoot'],
    replacement: function (content) {
      return content;
    }
  });
}

// 支持 ES Module 导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { addTurndownRules };
}
