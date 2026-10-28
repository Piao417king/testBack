/**
 * 回滚 replace-game-refs 误替换：
 * - bt.config: 等（主脚本 FULL_FILE_LITERAL_FIXES 也会处理，此处再跑一遍保险）
 * 不再把 app.SysConf / app.buildingInfoCreateMgr.* 回滚（与 replace-game-refs 一致）
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const projectRoot = path.join(__dirname, '..');
const scriptDir = path.join(projectRoot, 'game', 'assets', 'script');
const cfgManagerPath = path.join(scriptDir, 'common', 'config', 'CfgManager.ts');

const TEXT_FIXES = [
    ['bt.config:', 'config:'],
    ['public bt.config:', 'public config:'],
    ['private bt.config:', 'private config:'],
    ['protected bt.config:', 'protected config:'],
];

/** import / extends 被误加 app.buildingInfoCreateMgr. 前缀 */
function revertBrokenBuildingInfoImports(content) {
    let out = content.replace(/^import app\.buildingInfoCreateMgr\.(\w+) from /gm, 'import $1 from ');
    out = out.replace(/extends app\.buildingInfoCreateMgr\.(\w+)/g, 'extends $1');
    return out;
}

/** 类成员名被误加 bt. 前缀，如 protected bt.btHero: */
function revertMisqualifiedMemberNames(content) {
    return content.replace(
        /(\b(?:protected|private|public|readonly|static)\s+(?:readonly\s+)*)bt\.(bt[A-Z][\w]*)\b(?=\s*:)/g,
        '$1$2'
    );
}

function cfgManagerImportLine(fromFile) {
    const rel = path
        .relative(path.dirname(fromFile), cfgManagerPath)
        .replace(/\\/g, '/')
        .replace(/\.ts$/, '');
    const importPath = rel.startsWith('.') ? rel : `./${rel}`;
    return `import { SysConf } from "${importPath}";\n`;
}

function needsSysConfImport(content) {
    if (!/\bSysConf\b/.test(content)) return false;
    if (/import\s*\{[^}]*\bSysConf\b/.test(content)) return false;
    return true;
}

function tryGitSysConfImport(filePath) {
    try {
        const rel = path.relative(projectRoot, filePath).replace(/\\/g, '/');
        const out = execSync(`git show HEAD:"${rel}"`, {
            encoding: 'utf8',
            cwd: projectRoot,
            stdio: ['pipe', 'pipe', 'ignore'],
        });
        const m = out.match(/^import\s*\{[^}]*\bSysConf\b[^}]*\}\s*from\s*['"][^'"]+['"]\s*;?\s*$/m);
        return m ? `${m[0]}\n` : null;
    } catch {
        return null;
    }
}

function processFile(filePath) {
    let content = fs.readFileSync(filePath, 'utf8');
    const original = content;
    for (const [from, to] of TEXT_FIXES) {
        if (content.includes(from)) content = content.split(from).join(to);
    }
    if (/^import app\.buildingInfoCreateMgr\./m.test(content)) {
        content = revertBrokenBuildingInfoImports(content);
    }
    if (/\b(?:protected|private|public)\s+bt\.bt[A-Z]/.test(content)) {
        content = revertMisqualifiedMemberNames(content);
    }
    if (filePath === cfgManagerPath) {
        if (content !== original) fs.writeFileSync(filePath, content, 'utf8');
        return content !== original;
    }
    if (content !== original) {
        try {
            fs.writeFileSync(filePath, content, 'utf8');
            return true;
        } catch (err) {
            console.warn('写入失败，跳过:', filePath, err.message);
            return false;
        }
    }
    return false;
}

function walk(dir, list) {
    for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        if (fs.statSync(full).isDirectory()) walk(full, list);
        else if (name.endsWith('.ts') && !name.endsWith('.d.ts') && processFile(full)) list.push(full);
    }
    return list;
}

const modified = walk(scriptDir, []);
modified.forEach((f) => console.log(f));
console.log('\nFixed', modified.length, 'files');
