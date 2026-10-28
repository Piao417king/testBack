/**
 * 从 event 和 constant 文件夹的 .ts 源文件生成 game_api.d.ts
 * 输出格式：declare namespace game { ... }
 *
 * 使用（在项目根目录 updateCfg 下）：
 *   node game/scripts/generate_game_api_dts.js
 *
 * 或在 game 目录下：
 *   node scripts/generate_game_api_dts.js
 */

const fs = require('fs');
const path = require('path');

// 脚本所在目录为 game/scripts，GAME_DIR = game
const GAME_DIR = path.resolve(__dirname, '..');

const CONSTANT_DIR = path.join(GAME_DIR,'game' ,'assets', 'deppkg', 'game', 'common', 'constant');
const EVENT_DIR = path.join(GAME_DIR, 'game' ,'assets', 'deppkg', 'game', 'common', 'event');
const OUT_FILE = path.join(GAME_DIR,'game', 'declares', 'game_api.d.ts');

// 要参与生成的文件及顺序（仅 .ts，不含 .meta）
const CONSTANT_FILES = ['Constant.ts', 'Enums.ts'];
const EVENT_FILES = ['EventType.ts', 'NotEvent.ts', 'RedPointEvent.ts', 'TimeStampEventTypes.ts'];

const STOP_MARKERS = [
    /^\s*var\s+tempGame\s*[:=]/m,
    /^\s*const\s+allExports\s*=\s*\{/m,
];

/**
 * 从文件内容中截取「声明部分」：到 var tempGame / const allExports 所在行之前
 */
function extractDeclarations(content) {
    const lines = content.split('\n');
    let endLineIndex = lines.length;
    for (let i = 0; i < lines.length; i++) {
        for (const marker of STOP_MARKERS) {
            if (marker.test(lines[i])) {
                if (i < endLineIndex) endLineIndex = i;
                break;
            }
        }
    }
    return lines.slice(0, endLineIndex).join('\n').trimEnd();
}

/**
 * 去掉 export、统一为 namespace 内风格（保留注释与 const/enum/var）
 */
function toNamespaceBody(content) {
    return content
        .replace(/^\s*export\s+/gm, '')
        .split('\n')
        .map(line => (line.length > 0 ? '    ' + line : ''))
        .join('\n');
}

function readAndProcess(dir, fileNames) {
    const parts = [];
    for (const name of fileNames) {
        const filePath = path.join(dir, name);
        if (!fs.existsSync(filePath)) {
            console.warn('跳过不存在的文件: ' + filePath);
            continue;
        }
        const raw = fs.readFileSync(filePath, 'utf8');
        const decl = extractDeclarations(raw);
        if (!decl) continue;
        parts.push(toNamespaceBody(decl));
    }
    return parts.join('\n\n');
}

function main() {
    const constantContent = readAndProcess(CONSTANT_DIR, CONSTANT_FILES);
    const eventContent = readAndProcess(EVENT_DIR, EVENT_FILES);

    const fullContent = [
        'declare namespace game {',
        constantContent,
        eventContent,
        '}',
        ''
    ].join('\n\n');

    const outDir = path.dirname(OUT_FILE);
    if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
    }
    fs.writeFileSync(OUT_FILE, fullContent, 'utf8');
    console.log('已生成: ' + OUT_FILE);
}

main();
