/**
 * 扫描 game/declares 下 .d.ts，按 declare namespace 解析符号，
 * 对代码做 game.xxx / core.xxx / bt.xxx 替换（单次扫描标识符，避免数百条正则）。
 */

const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '..');
const scriptDir = path.join(projectRoot, 'game', 'assets', 'script');
const declaresDir = path.join(projectRoot, 'game', 'declares');

const SKIP_DECLARE_FILES = new Set([
    'creator.d.ts',
    'config.d.ts',
    'core_cc_ex.d.ts',
    'core_std_ex.d.ts',
    'messages.d.ts',
]);

const SKIP_ROOT_NAMESPACES = new Set(['cc', 'dragonBones', 'sp', 'jsb', 'Zlib']);
/** 不扫描的 namespace（空=仅跳过上面列表；app 需参与 SysConf、buildingInfoCreateMgr 等） */
const SKIP_AUTO_REPLACE_NAMESPACES = new Set([]);

/** 不参与批量替换的脚本（Application 内 app.SysConf = SysConf 等需保留本地类引用） */
const SKIP_SCRIPT_FILES = new Set(['Application.ts']);

/** model/info 下建筑实现类：仅本地 import 基类，禁止跑全局符号替换 */
const SKIP_SCRIPT_PATH_RE = /[/\\]model[/\\]info[/\\](BaseBuildingInfo|BaseDisassemblyInfo|.+BuildingInfo|OrnamentInfo|BarrierInfo)\.ts$/;

const SYMBOL_BLACKLIST = new Set(['config']);

const LITERAL_REPLACEMENTS = [
    ['core.ut.', 'core.utils.ut.'],
    ['@core.ModelMgr', '@core.manager.ModelMgr'],
    ['core.RequestParams', 'core.base.RequestParams'],
    ['core.BasePnlCtrl', 'core.base.BasePnlCtrl'],
    ['core.BaseModel', 'core.base.BaseModel'],
    ['core.ActionHelper.', 'core.utils.ActionHelper.'],
];

const FULL_FILE_LITERAL_FIXES = [
    ['core.AssetsLoadQueue', 'core.manager.AssetsLoadQueue'],
    ['import app.buildingInfoCreateMgr.', 'import '],
    ['bt.config:', 'config:'],
    ['public bt.config:', 'public config:'],
    ['private bt.config:', 'private config:'],
    ['protected bt.config:', 'protected config:'],
];

const IDENT_START = /[A-Za-z_$]/;
const IDENT_PART = /[\w$]/;
const WS = /\s/;

function splitProtectedSegments(content) {
    const segments = [];
    let i = 0;
    let codeStart = 0;
    const len = content.length;
    const pushCode = (end) => {
        if (end > codeStart) segments.push({ code: true, text: content.slice(codeStart, end) });
    };
    const pushProtected = (start, end) => {
        if (end > start) segments.push({ code: false, text: content.slice(start, end) });
    };

    while (i < len) {
        const c = content[i];
        const n = i + 1 < len ? content[i + 1] : '';

        if (c === '/' && n === '/') {
            pushCode(i);
            const start = i;
            i += 2;
            while (i < len && content[i] !== '\n') i++;
            pushProtected(start, i);
            codeStart = i;
            continue;
        }
        if (c === '/' && n === '*') {
            pushCode(i);
            const start = i;
            i += 2;
            while (i < len && !(content[i] === '*' && i + 1 < len && content[i + 1] === '/')) i++;
            i = i < len ? i + 2 : i;
            pushProtected(start, i);
            codeStart = i;
            continue;
        }
        if (c === '\'' || c === '"' || c === '`') {
            pushCode(i);
            const quote = c;
            const start = i;
            i++;
            while (i < len) {
                const ch = content[i];
                if (ch === '\\') {
                    i += 2;
                    continue;
                }
                if (ch === quote) {
                    i++;
                    break;
                }
                i++;
            }
            pushProtected(start, i);
            codeStart = i;
            continue;
        }
        i++;
    }

    pushCode(len);
    return segments;
}

/**
 * 模板字符串内仅转换 ${...} 表达式，纯文本部分不动
 */
function transformTemplateLiteralSegment(templateText, transformCodeFn) {
    if (!templateText || templateText[0] !== '`') return templateText;

    let out = '';
    let i = 0;
    const len = templateText.length;

    while (i < len) {
        const c = templateText[i];
        const n = i + 1 < len ? templateText[i + 1] : '';

        if (c === '\\') {
            out += c + (n || '');
            i += 2;
            continue;
        }

        if (c === '$' && n === '{') {
            out += '${';
            i += 2;
            const exprStart = i;
            let depth = 1;
            while (i < len && depth > 0) {
                const ch = templateText[i];
                const nx = i + 1 < len ? templateText[i + 1] : '';
                if (ch === '\'' || ch === '"' || ch === '`') {
                    const q = ch;
                    i++;
                    while (i < len) {
                        if (templateText[i] === '\\') {
                            i += 2;
                            continue;
                        }
                        if (templateText[i] === q) {
                            i++;
                            break;
                        }
                        i++;
                    }
                    continue;
                }
                if (ch === '/' && nx === '/') {
                    i += 2;
                    while (i < len && templateText[i] !== '\n') i++;
                    continue;
                }
                if (ch === '/' && nx === '*') {
                    i += 2;
                    while (i < len && !(templateText[i] === '*' && templateText[i + 1] === '/')) i++;
                    i += 2;
                    continue;
                }
                if (ch === '{') depth++;
                else if (ch === '}') {
                    depth--;
                    if (depth === 0) break;
                }
                i++;
            }
            const expr = templateText.slice(exprStart, i);
            out += transformCodeFn(expr);
            if (i < len && templateText[i] === '}') {
                out += '}';
                i++;
            }
            continue;
        }

        out += c;
        i++;
    }
    return out;
}

function transformCodeSegments(content, transformCodeFn) {
    const segments = splitProtectedSegments(content);
    let out = '';
    for (const seg of segments) {
        if (seg.code) {
            out += transformCodeFn(seg.text);
        } else if (seg.text[0] === '`') {
            out += transformTemplateLiteralSegment(seg.text, transformCodeFn);
        } else {
            out += seg.text;
        }
    }
    return out;
}

/** 匹配成对 {}，跳过字符串与注释，避免 d.ts 内嵌 { 导致 namespace 截断 */
function findMatchingBrace(content, openIndex) {
    let depth = 0;
    let i = openIndex;
    const len = content.length;
    while (i < len) {
        const c = content[i];
        const n = i + 1 < len ? content[i + 1] : '';

        if (c === '\'' || c === '"' || c === '`') {
            const quote = c;
            i++;
            while (i < len) {
                if (content[i] === '\\') {
                    i += 2;
                    continue;
                }
                if (content[i] === quote) {
                    i++;
                    break;
                }
                i++;
            }
            continue;
        }
        if (c === '/' && n === '/') {
            i += 2;
            while (i < len && content[i] !== '\n') i++;
            continue;
        }
        if (c === '/' && n === '*') {
            i += 2;
            while (i < len && !(content[i] === '*' && i + 1 < len && content[i + 1] === '/')) i++;
            i = i < len ? i + 2 : i;
            continue;
        }

        if (c === '{') depth++;
        else if (c === '}') {
            depth--;
            if (depth === 0) return i;
        }
        i++;
    }
    return -1;
}

function walkNamespaceBody(body, pathParts, symbolMap, conflicts) {
    let i = 0;
    const len = body.length;
    while (i < len) {
        while (i < len && WS.test(body[i])) i++;
        if (i >= len) break;

        const nsM = body.slice(i).match(/^(?:export\s+)?declare\s+namespace\s+(\w+)\s*\{/);
        if (nsM) {
            const braceStart = i + nsM[0].length - 1;
            const braceEnd = findMatchingBrace(body, braceStart);
            if (braceEnd < 0) break;
            walkNamespaceBody(
                body.slice(braceStart + 1, braceEnd),
                pathParts.concat(nsM[1]),
                symbolMap,
                conflicts
            );
            i = braceEnd + 1;
            continue;
        }

        const declM = body.slice(i).match(/^(?:export\s+)?(?:abstract\s+)?(enum|const|class|type|interface)\s+(\w+)/);
        if (declM) {
            const name = declM[2];
            if (!SYMBOL_BLACKLIST.has(name)) {
                const qualified = pathParts.concat(name).join('.');
                if (symbolMap.has(name)) {
                    const prev = symbolMap.get(name);
                    if (prev !== qualified) conflicts.add(name);
                } else {
                    symbolMap.set(name, qualified);
                }
            }
            i += declM[0].length;
            continue;
        }
        i++;
    }
}

function parseDeclareNamespace(filePath, rootNamespace) {
    if (!fs.existsSync(filePath)) {
        return { symbolMap: new Map(), conflicts: new Set() };
    }
    const content = fs.readFileSync(filePath, 'utf8');
    const symbolMap = new Map();
    const conflicts = new Set();
    const rootM = content.match(/^\s*declare\s+namespace\s+(\w+)\s*\{/m);
    if (!rootM) return { symbolMap, conflicts };
    if (rootNamespace && rootM[1] !== rootNamespace) {
        return { symbolMap, conflicts };
    }
    const braceStart = content.indexOf('{', rootM.index);
    const braceEnd = findMatchingBrace(content, braceStart);
    if (braceEnd < 0) return { symbolMap, conflicts };
    walkNamespaceBody(content.slice(braceStart + 1, braceEnd), [rootM[1]], symbolMap, conflicts);
    return { symbolMap, conflicts };
}

function loadSymbolsFromDts() {
    const merged = new Map();
    const conflicts = new Set();
    const loadedFiles = [];

    function mergeFrom(source) {
        for (const [name, qualified] of source.symbolMap) {
            if (merged.has(name)) {
                if (merged.get(name) !== qualified) conflicts.add(name);
            } else {
                merged.set(name, qualified);
            }
        }
        for (const c of source.conflicts) conflicts.add(c);
    }

    if (!fs.existsSync(declaresDir)) {
        return { merged, conflicts, loadedFiles };
    }

    for (const file of fs
        .readdirSync(declaresDir)
        .filter((f) => f.endsWith('.d.ts'))
        .sort()) {
        if (SKIP_DECLARE_FILES.has(file)) continue;
        const full = path.join(declaresDir, file);
        const content = fs.readFileSync(full, 'utf8');
        const rootM = content.match(/^\s*declare\s+namespace\s+(\w+)\s*\{/m);
        if (!rootM) continue;
        const ns = rootM[1];
        if (SKIP_ROOT_NAMESPACES.has(ns) || SKIP_AUTO_REPLACE_NAMESPACES.has(ns)) continue;

        const parsed = parseDeclareNamespace(full, ns);
        if (parsed.symbolMap.size === 0) continue;
        mergeFrom(parsed);
        loadedFiles.push({ file, namespace: ns, count: parsed.symbolMap.size });
    }

    return { merged, conflicts, loadedFiles };
}

/** 构建 symbolName -> qualified（已排除冲突/黑名单） */
function buildSymbolLookup(merged, conflicts) {
    const lookup = new Map();
    for (const [symbolName, qualified] of merged) {
        if (!conflicts.has(symbolName) && !SYMBOL_BLACKLIST.has(symbolName)) {
            lookup.set(symbolName, qualified);
        }
    }
    return lookup;
}

function keywordBefore(code, start, keyword) {
    const k = keyword.length;
    if (start < k) return false;
    if (code.slice(start - k, start) !== keyword) return false;
    if (start === k) return true;
    return !IDENT_PART.test(code[start - k - 1]);
}

function isEnumOrVarDeclarationName(code, start) {
    if (keywordBefore(code, start, 'enum ')) return true;
    if (start >= 11 && code.slice(start - 11, start) === 'const enum ') return true;
    if (keywordBefore(code, start, 'let ')) return true;
    if (keywordBefore(code, start, 'const ')) return true;
    if (keywordBefore(code, start, 'var ')) return true;
    return false;
}

function skipWhitespaceForward(code, i, len) {
    while (i < len && WS.test(code[i])) i++;
    return i;
}

function skipWhitespaceBackward(code, start) {
    let p = start - 1;
    while (p >= 0 && WS.test(code[p])) p--;
    return p;
}

/**
 * 单次扫描替换标识符（等价于原 3 条正则/符号，但 O(文件长度)）
 */
function replaceIdentifiersInCode(code, lookup) {
    if (lookup.size === 0) return code;

    const len = code.length;
    let out = '';
    let i = 0;

    while (i < len) {
        const c = code[i];
        if (!IDENT_START.test(c)) {
            out += c;
            i++;
            continue;
        }

        const start = i;
        i++;
        while (i < len && IDENT_PART.test(code[i])) i++;
        const name = code.slice(start, i);

        const qualified = lookup.get(name);
        if (!qualified) {
            out += name;
            continue;
        }

        const charBefore = start > 0 ? code[start - 1] : '';
        if (charBefore === '.' || charBefore === '/') {
            out += name;
            continue;
        }

        if (isEnumOrVarDeclarationName(code, start)) {
            out += name;
            continue;
        }

        const prev = skipWhitespaceBackward(code, start);
        if (prev >= 0 && code[prev] === ':') {
            out += qualified;
            continue;
        }

        const next = skipWhitespaceForward(code, i, len);
        const ch = next < len ? code[next] : '';

        if (ch === ':') {
            out += name;
            continue;
        }
        if (ch === '=') {
            out += name;
            continue;
        }

        if (ch === '(') {
            const winStart = Math.max(0, start - 16);
            if (/\bnew\s*$/.test(code.slice(winStart, start))) {
                out += qualified;
            } else {
                out += name;
            }
            continue;
        }

        out += qualified;
    }

    return out;
}

/** 仅保留本文件中出现的标识符（O(文件长度)，避免对全表做 includes） */
function filterLookupForCode(code, lookup) {
    if (lookup.size === 0) return lookup;
    const active = new Map();
    const len = code.length;
    let i = 0;
    while (i < len) {
        const c = code[i];
        if (!IDENT_START.test(c)) {
            i++;
            continue;
        }
        const start = i;
        i++;
        while (i < len && IDENT_PART.test(code[i])) i++;
        const name = code.slice(start, i);
        if (!active.has(name) && lookup.has(name)) {
            active.set(name, lookup.get(name));
        }
    }
    return active;
}

function addParamNames(paramListText, names) {
    if (!paramListText) return;
    for (const raw of paramListText.split(',')) {
        let p = raw.trim();
        if (!p) continue;
        p = p.replace(/^\.{3}/, '').replace(/=.*/, '').trim();
        const m = p.match(/^([A-Za-z_$][\w$]*)\s*(?:\?|:|$)/);
        if (m) names.add(m[1]);
    }
}

function getLocalDeclaredNames(content) {
    const names = new Set();
    const patterns = [
        /\b(?:const\s+)?enum\s+(\w+)\b/g,
        /\b(?:let|const|var)\s+(\w+)\b/g,
        /\bfunction\s+(\w+)\b/g,
        /\b(?:class|interface|type)\s+(\w+)\b/g,
    ];
    for (const re of patterns) {
        let m;
        while ((m = re.exec(content))) names.add(m[1]);
    }
    for (const m of content.matchAll(/\bfunction\s+\w+\s*\(([^)]*)\)/g)) {
        addParamNames(m[1], names);
    }
    for (const m of content.matchAll(
        /^\s*(?:(?:public|private|protected|static|async|readonly)\s+)*(?!if\b|for\b|while\b|switch\b|catch\b)(?:constructor|\w+)\s*\(([^)]*)\)\s*(?::[^{=>\n]+)?\s*\{/gm
    )) {
        addParamNames(m[1], names);
    }
    for (const m of content.matchAll(
        /^\s*(?:(?:public|private|protected|static|readonly)\s+)+\s*(\w+)\s*[:=]/gm
    )) {
        names.add(m[1]);
    }
    return names;
}

function applyLiteralReplacements(code, pairs) {
    let out = code;
    for (const [from, to] of pairs) {
        if (out.includes(from)) out = out.split(from).join(to);
    }
    return out;
}

function collectTsFiles(dir, list = []) {
    for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        if (fs.statSync(full).isDirectory()) collectTsFiles(full, list);
        else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) list.push(full);
    }
    return list;
}

const { merged: SYMBOL_MAP, conflicts: SYMBOL_CONFLICTS, loadedFiles: LOADED_DECLARE_FILES } =
    loadSymbolsFromDts();
const SYMBOL_LOOKUP = buildSymbolLookup(SYMBOL_MAP, SYMBOL_CONFLICTS);
const TO_REMOVE_SET = new Set(
    [...SYMBOL_MAP.keys()].filter((k) => !SYMBOL_CONFLICTS.has(k) && !SYMBOL_BLACKLIST.has(k))
);

function shouldSkipScriptFile(filePath) {
    const base = path.basename(filePath);
    if (SKIP_SCRIPT_FILES.has(base)) return true;
    return SKIP_SCRIPT_PATH_RE.test(filePath);
}

/** import 行不参与标识符替换，避免 import app.xxx.Y from 非法语法 */
function maskImportLines(content) {
    const store = [];
    const masked = content.replace(/^import\s[\s\S]*?;?[ \t]*\r?\n/gm, (line) => {
        const id = store.length;
        store.push(line);
        return `/*__IMPORT_MASK_${id}__*/`;
    });
    return { masked, store };
}

function unmaskImportLines(content, store) {
    return content.replace(/\/\*__IMPORT_MASK_(\d+)__\*\//g, (_, i) => store[+i]);
}

function processFile(filePath, symbolLookup) {
    if (shouldSkipScriptFile(filePath)) return false;

    let content = fs.readFileSync(filePath, 'utf8');
    const original = content;

    if (TO_REMOVE_SET.size > 0) {
        content = content.replace(
            /^import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]\s*;?\s*\r?\n/gm,
            (match, importList) => {
                const items = importList
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean);
                if (!items.some((name) => TO_REMOVE_SET.has(name))) return match;
                const kept = items.filter((name) => !TO_REMOVE_SET.has(name));
                if (kept.length === 0) return '';
                const fromPath = match.match(/from\s*['"]([^'"]+)['"]/)[1];
                const hadSemi = /;\s*\r?\n$/.test(match);
                const lineBreak = match.match(/\r?\n$/)?.[0] || '\n';
                return `import { ${kept.join(', ')} } from "${fromPath}"${hadSemi ? ';' : ''}${lineBreak}`;
            }
        );
    }

    const localDeclared = getLocalDeclaredNames(content);
    let lookup = symbolLookup;
    if (localDeclared.size > 0) {
        lookup = new Map();
        for (const [name, qualified] of symbolLookup) {
            if (!localDeclared.has(name)) lookup.set(name, qualified);
        }
    }

    const { masked, store: importStore } = maskImportLines(content);
    const activeLookup = filterLookupForCode(masked, lookup);
    const transformCodeChunk = (code) => {
        let out = replaceIdentifiersInCode(code, activeLookup);
        return applyLiteralReplacements(out, LITERAL_REPLACEMENTS);
    };

    const codeOnly = transformCodeSegments(masked, transformCodeChunk);
    content = unmaskImportLines(codeOnly, importStore);

    content = applyLiteralReplacements(content, FULL_FILE_LITERAL_FIXES);

    if (content === original) {
        return false;
    }
    if (process.env.DRY_RUN === '1') return true;
    try {
        fs.writeFileSync(filePath, content, 'utf8');
        return true;
    } catch (err) {
        console.warn('写入失败，跳过:', filePath, err.message);
        return false;
    }
}

function walk(dir, modifiedList, symbolLookup) {
    const files = collectTsFiles(dir);
    const total = files.length;
    let done = 0;
    const progressEvery = Math.max(50, Math.floor(total / 20));
    for (const full of files) {
        if (processFile(full, symbolLookup)) modifiedList.push(full);
        done++;
        if (done % progressEvery === 0 || done === total) {
            console.log(`进度 ${done}/${total}，已修改 ${modifiedList.length} 个文件`);
        }
    }
    return modifiedList;
}

if (require.main === module) {
    const t0 = Date.now();
    console.log('declares 目录:', declaresDir);
    console.log(
        '符号表:',
        SYMBOL_LOOKUP.size,
        '个，冲突跳过:',
        SYMBOL_CONFLICTS.size
    );
    for (const { file, namespace, count } of LOADED_DECLARE_FILES) {
        console.log(`  - ${file}  namespace ${namespace}  (${count})`);
    }
    if (SYMBOL_CONFLICTS.size) {
        console.log('冲突:', [...SYMBOL_CONFLICTS].sort().join(', '));
    }
    if (SKIP_SCRIPT_FILES.size) {
        console.log('跳过文件:', [...SKIP_SCRIPT_FILES].join(', '));
    }

    const modifiedList = walk(scriptDir, [], SYMBOL_LOOKUP);
    modifiedList.forEach((f) => console.log(f));
    console.log('\nModified', modifiedList.length, 'files，耗时', Date.now() - t0, 'ms');
}

module.exports = {
    loadSymbolsFromDts,
    SYMBOL_MAP,
    SYMBOL_CONFLICTS,
    LOADED_DECLARE_FILES,
    SYMBOL_LOOKUP,
    TO_REMOVE: [...TO_REMOVE_SET],
    TO_REMOVE_SET,
    declaresDir,
    SKIP_SCRIPT_FILES,
    processFile,
    shouldSkipScriptFile,
    replaceIdentifiersInCode,
    buildSymbolLookup,
};
