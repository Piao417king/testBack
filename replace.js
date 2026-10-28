/**
 * 将 EventType、ResourceID、TextColor、RedDotNames、LOCAL_STORAGE_KEY 替换为 game.XXX
 * 规则：前面有 . 的不替换（如 game.EventType 不再替换）
 */

const fs = require('fs');
const path = require('path');

const scriptDir = path.join(__dirname, 'game', 'assets', 'script');

// 使用 (?<![.]) 表示前面不是 . 时才匹配，避免把 game.EventType 改成 game.game.EventType
const REPLACEMENTS = [
  [/(?<![.])\bEventType\b/g, 'game.EventType'],
  [/(?<![.])\bResourceID\b/g, 'game.ResourceID'],
  [/(?<![.])\bTextColor\b/g, 'game.TextColor'],
  [/(?<![.])\bRedDotNames\b/g, 'game.RedDotNames'],
  [/(?<![.])\bLOCAL_STORAGE_KEY\b/g, 'game.LOCAL_STORAGE_KEY'],
  [/(?<![.])\bEActivityType\b/g, 'game.EActivityType'],
  [/(?<![.])\bHelpText\b/g, 'game.HelpText'],
];

const TO_REMOVE = ['EventType', 'ResourceID', 'TextColor', 'RedDotNames', 'LOCAL_STORAGE_KEY' , 'EActivityType' , 'HelpText'];

function processFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  const original = content;

  // 1. 只对「包含待移除标识符」的 import 做处理；用 \r?\n 显式吃掉行尾换行，删整行时不会留下空行
  content = content.replace(
    /^import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]\s*;?\s*\r?\n/gm,
    (match, importList, fromPath) => {
      const items = importList
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const hasRemove = items.some((name) => TO_REMOVE.includes(name.trim()));
      if (!hasRemove) return match; // 没包含要移除的，原样返回，不改动
      const kept = items.filter((name) => !TO_REMOVE.includes(name.trim()));
      if (kept.length === 0) return ''; // 整行（含换行）已由上面的 \r?\n 匹配掉，不会多出空行
      return `import { ${kept.join(', ')} } from "${fromPath}";\n`;
    }
  );

  // 2. 替换代码中的标识符（前面有 . 的不替换）
  for (const [re, replacement] of REPLACEMENTS) {
    content = content.replace(re, replacement);
  }

  if (content !== original) {
    fs.writeFileSync(filePath, content, 'utf8');
    return true;
  }
  return false;
}

function walk(dir) {
  let count = 0;
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const full = path.join(dir, file);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      count += walk(full);
    } else if (file.endsWith('.ts') && !file.endsWith('.d.ts')) {
      if (processFile(full)) count++;
    }
  }
  return count;
}

const n = walk(scriptDir);
console.log('Modified', n, 'files');
