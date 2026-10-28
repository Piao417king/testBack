'use strict';

/**
 * 扫描 game/assets 下 .prefab / .fire 中所有 __uuid__ 引用，与 .meta 注册的 uuid（含 subMetas、rawTextureUuid）对照。
 * 未命中且不在白名单内的视为疑似丢失资源。自定义脚本的「丢失脚本」需用编辑器 Inspector 或控制台排查，本工具只检查 UUID 型资源引用。
 *
 * ========== 基本用法 ==========
 * 在仓库根目录 feature2_iqiyi 下执行（默认 assets 为 game/assets，白名单为同目录 prefab-uuid-engine-whitelist.json，与工作目录无关）:
 *
 *   node private/check-prefab-uuid-refs.js
 *   node private/check-prefab-uuid-refs.js -h
 *
 * 指定资源根或白名单（路径相对当前 shell 工作目录）:
 *
 *   node private/check-prefab-uuid-refs.js --assets game/assets
 *   node private/check-prefab-uuid-refs.js --whitelist private/prefab-uuid-engine-whitelist.json
 *
 * 只扫预制体、不扫场景:
 *
 *   node private/check-prefab-uuid-refs.js --no-fire
 *
 * 少打日志:
 *
 *   node private/check-prefab-uuid-refs.js -q
 *
 * ========== 引擎内置 UUID（白名单）==========
 * 引擎或 internal 资源不在项目 assets 的 .meta 里，需列入 prefab-uuid-engine-whitelist.json。
 *
 * 升级 Creator 或内置引用变化后，可先导出「prefab 里出现、但项目 meta 未登记」的 UUID，核对后合并进白名单:
 *
 *   node private/check-prefab-uuid-refs.js --dump-meta-orphans
 *
 * 输出每行一个 UUID，最后一行以 # 开头为统计说明。其中多为引擎资源；若确认是误删工程资源，应恢复资源而不是写入白名单。
 *
 * 若本机已安装 Cocos Creator，可把安装目录下含大量 .meta 的子目录额外编入已知集（路径按本机安装调整，可多次传入）:
 *
 *   node private/check-prefab-uuid-refs.js --extra-meta-dir "D:/CocosCreator/Creator/2.4.12/resources/某子目录"
 *
 * ========== 编辑器里查单个资源 UUID ==========
 * 资源管理器选中资源 → 右键菜单中复制 UUID 或查看 UUID（不同小版本文案可能不同）；亦可用官方扩展 asset-db 相关接口查询。
 *
 * ========== 退出码 ==========
 *   0 — 未发现空 UUID 或未知 UUID
 *   1 — 存在空 __uuid__ 或未知 UUID（相对 meta + 白名单 + extra-meta-dir）
 */

const fs = require('fs');
const path = require('path');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normUuid(s) {
  return typeof s === 'string' ? s.trim().toLowerCase() : '';
}

function parseArgs(argv) {
  const opts = {
    assetsDir: path.join(__dirname, '..', 'game', 'assets'),
    whitelistPath: path.join(__dirname, 'prefab-uuid-engine-whitelist.json'),
    scanFire: true,
    quiet: false,
    dumpMetaOrphans: false,
    extraMetaDirs: [],
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--assets' && argv[i + 1]) {
      opts.assetsDir = path.resolve(process.cwd(), argv[++i]);
    } else if (a === '--whitelist' && argv[i + 1]) {
      opts.whitelistPath = path.resolve(process.cwd(), argv[++i]);
    } else if (a === '--extra-meta-dir' && argv[i + 1]) {
      opts.extraMetaDirs.push(path.resolve(process.cwd(), argv[++i]));
    } else if (a === '--no-fire') {
      opts.scanFire = false;
    } else if (a === '--quiet' || a === '-q') {
      opts.quiet = true;
    } else if (a === '--dump-meta-orphans') {
      opts.dumpMetaOrphans = true;
    } else if (a === '--help' || a === '-h') {
      opts.help = true;
    }
  }
  return opts;
}

function walkFiles(rootDir, testBaseName) {
  const out = [];
  function walk(d) {
    let names;
    try {
      names = fs.readdirSync(d, { withFileTypes: true });
    } catch (e) {
      return;
    }
    for (const ent of names) {
      const full = path.join(d, ent.name);
      if (ent.isDirectory()) {
        walk(full);
      } else if (ent.isFile() && testBaseName(ent.name)) {
        out.push(full);
      }
    }
  }
  walk(rootDir);
  return out;
}

function collectMetaUuids(metaJson, set) {
  if (!metaJson || typeof metaJson !== 'object') return;
  const u = normUuid(metaJson.uuid);
  if (u && UUID_RE.test(u)) set.add(u);
  const rt = normUuid(metaJson.rawTextureUuid);
  if (rt && UUID_RE.test(rt)) set.add(rt);
  const subs = metaJson.subMetas;
  if (subs && typeof subs === 'object') {
    for (const k of Object.keys(subs)) {
      collectMetaUuids(subs[k], set);
    }
  }
}

function extractPrefabUuids(node, out) {
  if (node === null || node === undefined) return;
  if (Array.isArray(node)) {
    for (const x of node) extractPrefabUuids(x, out);
    return;
  }
  if (typeof node !== 'object') return;
  for (const [k, v] of Object.entries(node)) {
    if (k === '__uuid__') {
      if (typeof v === 'string') {
        out.push(v);
      }
      continue;
    }
    if (v !== null && typeof v === 'object') {
      extractPrefabUuids(v, out);
    }
  }
}

function loadWhitelist(filePath) {
  const set = new Set();
  if (!fs.existsSync(filePath)) return set;
  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    console.error('白名单 JSON 解析失败:', filePath, e.message);
    process.exit(1);
  }
  const arr = Array.isArray(data) ? data : data.uuids;
  if (!Array.isArray(arr)) return set;
  for (const x of arr) {
    const u = normUuid(x);
    if (u && UUID_RE.test(u)) set.add(u);
  }
  return set;
}

function main() {
  const opts = parseArgs(process.argv);
  if (opts.help) {
    const src = fs.readFileSync(__filename, 'utf8');
    const m = src.match(/\/\*\*[\s\S]*?\*\//);
    console.log(m ? m[0] : '');
    process.exit(0);
  }

  if (!fs.existsSync(opts.assetsDir)) {
    console.error('assets 目录不存在:', opts.assetsDir);
    process.exit(1);
  }

  const known = new Set();
  const metaFiles = walkFiles(opts.assetsDir, (name) => name.endsWith('.meta'));
  for (const fp of metaFiles) {
    let raw;
    try {
      raw = fs.readFileSync(fp, 'utf8');
    } catch (e) {
      continue;
    }
    let j;
    try {
      j = JSON.parse(raw);
    } catch (e) {
      continue;
    }
    collectMetaUuids(j, known);
  }

  const metaUuidCount = known.size;

  for (const dir of opts.extraMetaDirs) {
    if (!fs.existsSync(dir)) {
      console.error('警告: --extra-meta-dir 不存在，已跳过:', dir);
      continue;
    }
    const extraMetas = walkFiles(dir, (name) => name.endsWith('.meta'));
    for (const fp of extraMetas) {
      let raw;
      try {
        raw = fs.readFileSync(fp, 'utf8');
      } catch (e) {
        continue;
      }
      let j;
      try {
        j = JSON.parse(raw);
      } catch (e) {
        continue;
      }
      collectMetaUuids(j, known);
    }
    if (!opts.quiet && !opts.dumpMetaOrphans) {
      console.log(`已自 extra-meta-dir 合并: ${dir}（${extraMetas.length} 个 .meta）`);
    }
  }

  const knownFromMetaAndExtra = new Set(known);

  const whitelist = loadWhitelist(opts.whitelistPath);
  for (const u of whitelist) known.add(u);

  if (opts.dumpMetaOrphans) {
    const exts = opts.scanFire ? ['.prefab', '.fire'] : ['.prefab'];
    const assetFiles = walkFiles(opts.assetsDir, (name) =>
      exts.some((ext) => name.endsWith(ext))
    );
    const seen = new Set();
    for (const fp of assetFiles) {
      let arr;
      try {
        arr = JSON.parse(fs.readFileSync(fp, 'utf8'));
      } catch (e) {
        continue;
      }
      const found = [];
      extractPrefabUuids(arr, found);
      for (const rawU of found) {
        const u = normUuid(rawU);
        if (!u || !UUID_RE.test(u)) continue;
        if (!knownFromMetaAndExtra.has(u)) seen.add(u);
      }
    }
    for (const u of [...seen].sort()) {
      console.log(u);
    }
    if (!opts.quiet) {
      console.log(
        `# dump-meta-orphans: 共 ${seen.size} 个（相对 assets 与 --extra-meta-dir 的 .meta，不含白名单）`
      );
    }
    process.exit(0);
  }

  const exts = opts.scanFire ? ['.prefab', '.fire'] : ['.prefab'];
  const assetFiles = walkFiles(opts.assetsDir, (name) =>
    exts.some((ext) => name.endsWith(ext))
  );

  let hasError = false;
  const orphanByFile = new Map();
  let emptyCountFiles = 0;

  for (const fp of assetFiles) {
    let raw;
    try {
      raw = fs.readFileSync(fp, 'utf8');
    } catch (e) {
      continue;
    }
    let arr;
    try {
      arr = JSON.parse(raw);
    } catch (e) {
      console.error('JSON 解析失败（跳过）:', fp, e.message);
      hasError = true;
      continue;
    }
    const found = [];
    extractPrefabUuids(arr, found);

    let fileEmpty = 0;
    const orphans = [];
    for (const rawU of found) {
      const u = normUuid(rawU);
      if (!u) {
        fileEmpty++;
        continue;
      }
      if (!UUID_RE.test(u)) {
        orphans.push(rawU);
        continue;
      }
      if (!known.has(u)) {
        orphans.push(u);
      }
    }

    if (fileEmpty > 0) {
      emptyCountFiles++;
      hasError = true;
      if (!opts.quiet) {
        console.error(`[空 UUID] ${path.relative(opts.assetsDir, fp)} (${fileEmpty} 处)`);
      }
    }
    if (orphans.length > 0) {
      hasError = true;
      orphanByFile.set(fp, orphans);
    }
  }

  if (orphanByFile.size > 0 && !opts.quiet) {
    for (const [fp, list] of orphanByFile) {
      const uniq = [...new Set(list)];
      const rel = path.relative(opts.assetsDir, fp);
      console.error(`[未知 UUID] ${rel}`);
      for (const u of uniq) {
        console.error(`  - ${u}`);
      }
    }
  }

  if (!opts.quiet) {
    console.log(
      `已索引 .meta: ${metaFiles.length} 个，自 meta 收集 UUID: ${metaUuidCount}，白名单: ${whitelist.size}，合计已知: ${known.size}`
    );
    console.log(`已扫描: ${assetFiles.length} 个 ${exts.join('/')}`);
    if (!hasError) {
      console.log('未发现 prefab/fire 中缺失的 UUID 引用（相对当前 assets 与白名单）。');
    }
  }

  process.exit(hasError ? 1 : 0);
}

main();
