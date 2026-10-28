#!/usr/bin/env node
/**
 * 对比两个 Cocos Creator Prefab 的节点树结构与组件
 *
 * 用法:
 *   node scripts/compare-prefab.js <prefabA> <prefabB>
 *   node scripts/compare-prefab.js a.prefab b.prefab --props
 *
 * 选项:
 *   --props     额外对比组件序列化属性（默认只比组件类型）
 *   --json      以 JSON 输出结果
 *   --help      显示帮助
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function printHelp() {
    console.log(`
对比两个 Prefab 的节点树与组件

用法:
  node scripts/compare-prefab.js <prefabA> <prefabB> [选项]

选项:
  --props     额外对比组件属性值（默认只对比组件类型列表）
  --json      输出 JSON 结果
  --help      显示帮助

示例:
  node scripts/compare-prefab.js assets/UI/A.prefab assets/UI/B.prefab
  node scripts/compare-prefab.js A.prefab B.prefab --props
`);
}

function parseArgs(argv) {
    const args = { files: [], props: false, json: false, help: false };
    for (const a of argv) {
        if (a === '--props') args.props = true;
        else if (a === '--json') args.json = true;
        else if (a === '--help' || a === '-h') args.help = true;
        else if (!a.startsWith('-')) args.files.push(a);
    }
    return args;
}

// ---------------------------------------------------------------------------
// Prefab 解析
// ---------------------------------------------------------------------------

/**
 * 读取并解析 prefab JSON（支持数组格式与带 data 的对象）
 * @param {string} filePath
 * @returns {any[]}
 */
function loadPrefab(filePath) {
    const abs = path.resolve(filePath);
    if (!fs.existsSync(abs)) {
        throw new Error(`文件不存在: ${abs}`);
    }
    const text = fs.readFileSync(abs, 'utf8');
    let data;
    try {
        data = JSON.parse(text);
    } catch (e) {
        throw new Error(`JSON 解析失败: ${abs}\n${e.message}`);
    }
    if (Array.isArray(data)) {
        return data;
    }
    // 少数导出格式可能包一层
    if (data && Array.isArray(data.data)) {
        return data.data;
    }
    throw new Error(`无法识别的 Prefab 格式（期望 JSON 数组）: ${abs}`);
}

/**
 * 解析 __id__ 引用
 * @param {any} ref
 * @returns {number|null}
 */
function refId(ref) {
    if (ref == null) return null;
    if (typeof ref === 'number') return ref;
    if (typeof ref === 'object' && typeof ref.__id__ === 'number') return ref.__id__;
    return null;
}

/**
 * 判断是否为节点类型
 * @param {any} obj
 */
function isNode(obj) {
    if (!obj || typeof obj !== 'object') return false;
    const t = obj.__type__;
    return t === 'cc.Node' || t === 'cc.Scene' || t === 'cc.SceneAsset'
        || (typeof t === 'string' && /Node$/i.test(t) && Array.isArray(obj._children));
}

/**
 * 获取组件类型名（尽量可读）
 * @param {any} comp
 */
function getComponentType(comp) {
    if (!comp) return '(null)';
    const t = comp.__type__;
    if (typeof t === 'string') {
        // 自定义脚本常为 uuid，保留原样；内置组件如 cc.Sprite
        return t;
    }
    return String(t);
}

/**
 * 从 Prefab 数组构建节点树
 * @param {any[]} objects
 * @returns {{ name: string, path: string, components: string[], children: any[], raw: any, componentDetails: object[] }}
 */
function buildTree(objects) {
    // 找根节点：cc.Prefab.data -> 根 Node
    let rootId = null;
    for (let i = 0; i < objects.length; i++) {
        const o = objects[i];
        if (o && o.__type__ === 'cc.Prefab' && o.data) {
            rootId = refId(o.data);
            break;
        }
    }
    // Creator 3.x / 变体：PrefabInfo 等
    if (rootId == null) {
        for (let i = 0; i < objects.length; i++) {
            if (isNode(objects[i])) {
                // 没有父节点引用的第一个 Node 作为根
                const parent = objects[i]._parent;
                if (parent == null || refId(parent) == null) {
                    rootId = i;
                    break;
                }
            }
        }
    }
    if (rootId == null) {
        throw new Error('未找到 Prefab 根节点');
    }

    /**
     * @param {number} id
     * @param {string} parentPath
     */
    function walk(id, parentPath) {
        const node = objects[id];
        if (!node || !isNode(node)) {
            return null;
        }
        const name = node._name != null ? String(node._name) : `(unnamed#${id})`;
        const nodePath = parentPath ? `${parentPath}/${name}` : name;

        const components = [];
        const componentDetails = [];
        const comps = Array.isArray(node._components) ? node._components : [];
        for (const c of comps) {
            const cid = refId(c);
            if (cid == null || !objects[cid]) continue;
            const comp = objects[cid];
            const typeName = getComponentType(comp);
            components.push(typeName);
            componentDetails.push({
                type: typeName,
                props: extractProps(comp),
            });
        }

        const children = [];
        const childRefs = Array.isArray(node._children) ? node._children : [];
        for (const ch of childRefs) {
            const childId = refId(ch);
            if (childId == null) continue;
            const childNode = walk(childId, nodePath);
            if (childNode) children.push(childNode);
        }

        return {
            name,
            path: nodePath,
            components,
            componentDetails,
            children,
            id,
        };
    }

    return walk(rootId, '');
}

/**
 * 提取可对比的组件属性（过滤内部字段与引用）
 * @param {any} comp
 */
function extractProps(comp) {
    const skip = new Set([
        '__type__', '__id__', 'node', '_id', '_enabled',
        '_name', '_objFlags', '__prefab', 'uuid',
    ]);
    const out = {};
    for (const key of Object.keys(comp)) {
        if (skip.has(key) || key.startsWith('__')) continue;
        out[key] = simplifyValue(comp[key]);
    }
    return out;
}

/**
 * 简化值以便对比（引用只保留 __id__ / __uuid__）
 */
function simplifyValue(v) {
    if (v == null) return v;
    if (typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(simplifyValue);
    if (typeof v.__id__ === 'number') return { __id__: v.__id__ };
    if (typeof v.__uuid__ === 'string') return { __uuid__: v.__uuid__ };
    const o = {};
    for (const k of Object.keys(v)) {
        o[k] = simplifyValue(v[k]);
    }
    return o;
}

// ---------------------------------------------------------------------------
// 对比
// ---------------------------------------------------------------------------

/**
 * 扁平化节点树为 path -> node
 * @param {any} tree
 * @param {Map<string, any>} map
 */
function flatten(tree, map = new Map()) {
    if (!tree) return map;
    // 同名兄弟节点：追加索引避免覆盖
    let key = tree.path;
    if (map.has(key)) {
        let i = 2;
        while (map.has(`${tree.path}#${i}`)) i++;
        key = `${tree.path}#${i}`;
        tree = { ...tree, path: key };
    }
    map.set(key, tree);
    for (const child of tree.children) {
        flatten(child, map);
    }
    return map;
}

/**
 * 深度相等
 */
function deepEqual(a, b) {
    if (a === b) return true;
    if (a == null || b == null) return a === b;
    if (typeof a !== typeof b) return false;
    if (typeof a !== 'object') return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
            if (!deepEqual(a[i], b[i])) return false;
        }
        return true;
    }
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    if (ka.length !== kb.length) return false;
    for (let i = 0; i < ka.length; i++) {
        if (ka[i] !== kb[i]) return false;
        if (!deepEqual(a[ka[i]], b[kb[i]])) return false;
    }
    return true;
}

/**
 * @param {any} treeA
 * @param {any} treeB
 * @param {{ compareProps: boolean }} options
 */
function compareTrees(treeA, treeB, options) {
    const mapA = flatten(treeA);
    const mapB = flatten(treeB);

    const onlyInA = [];
    const onlyInB = [];
    const componentDiffs = [];
    const propDiffs = [];

    for (const [p, nodeA] of mapA) {
        if (!mapB.has(p)) {
            onlyInA.push({
                path: p,
                components: nodeA.components.slice(),
            });
        }
    }
    for (const [p, nodeB] of mapB) {
        if (!mapA.has(p)) {
            onlyInB.push({
                path: p,
                components: nodeB.components.slice(),
            });
        }
    }

    for (const [p, nodeA] of mapA) {
        const nodeB = mapB.get(p);
        if (!nodeB) continue;

        const setA = countTypes(nodeA.components);
        const setB = countTypes(nodeB.components);
        const allTypes = new Set([...setA.keys(), ...setB.keys()]);
        const missing = [];
        const extra = [];
        for (const t of allTypes) {
            const ca = setA.get(t) || 0;
            const cb = setB.get(t) || 0;
            if (ca > cb) missing.push(ca - cb === 1 ? t : `${t} x${ca - cb}`);
            if (cb > ca) extra.push(cb - ca === 1 ? t : `${t} x${cb - ca}`);
        }
        if (missing.length || extra.length) {
            componentDiffs.push({
                path: p,
                a: nodeA.components.slice(),
                b: nodeB.components.slice(),
                onlyInA: missing,
                onlyInB: extra,
            });
        }

        if (options.compareProps) {
            const diffs = compareComponentProps(nodeA.componentDetails, nodeB.componentDetails);
            if (diffs.length) {
                propDiffs.push({ path: p, diffs });
            }
        }
    }

    return {
        rootA: treeA.path,
        rootB: treeB.path,
        nodeCountA: mapA.size,
        nodeCountB: mapB.size,
        onlyInA,
        onlyInB,
        componentDiffs,
        propDiffs,
        identical:
            onlyInA.length === 0 &&
            onlyInB.length === 0 &&
            componentDiffs.length === 0 &&
            propDiffs.length === 0,
    };
}

/** @param {string[]} types */
function countTypes(types) {
    const m = new Map();
    for (const t of types) {
        m.set(t, (m.get(t) || 0) + 1);
    }
    return m;
}

/**
 * 按类型顺序对齐后对比属性
 * @param {{type:string, props:object}[]} detailsA
 * @param {{type:string, props:object}[]} detailsB
 */
function compareComponentProps(detailsA, detailsB) {
    const usedB = new Set();
    const diffs = [];

    for (let i = 0; i < detailsA.length; i++) {
        const a = detailsA[i];
        let matchIdx = -1;
        for (let j = 0; j < detailsB.length; j++) {
            if (usedB.has(j)) continue;
            if (detailsB[j].type === a.type) {
                matchIdx = j;
                break;
            }
        }
        if (matchIdx < 0) continue;
        usedB.add(matchIdx);
        const b = detailsB[matchIdx];
        const changed = [];
        const keys = new Set([...Object.keys(a.props), ...Object.keys(b.props)]);
        for (const k of keys) {
            if (!deepEqual(a.props[k], b.props[k])) {
                changed.push({
                    key: k,
                    a: a.props[k],
                    b: b.props[k],
                });
            }
        }
        if (changed.length) {
            diffs.push({ type: a.type, index: i, changed });
        }
    }
    return diffs;
}

// ---------------------------------------------------------------------------
// 输出
// ---------------------------------------------------------------------------

function printTree(node, indent = '') {
    const comps = node.components.length
        ? `  [${node.components.join(', ')}]`
        : '';
    console.log(`${indent}${node.name}${comps}`);
    for (const child of node.children) {
        printTree(child, indent + '  ');
    }
}

function printReport(result, fileA, fileB, options) {
    console.log('='.repeat(60));
    console.log('Prefab 对比结果');
    console.log('='.repeat(60));
    console.log(`A: ${path.resolve(fileA)}  (节点 ${result.nodeCountA})`);
    console.log(`B: ${path.resolve(fileB)}  (节点 ${result.nodeCountB})`);
    console.log('');

    if (result.identical) {
        console.log('✓ 树结构与组件完全一致' + (options.compareProps ? '（含属性）' : ''));
        return;
    }

    if (result.onlyInA.length) {
        console.log(`【仅在 A 中存在的节点】 (${result.onlyInA.length})`);
        for (const n of result.onlyInA) {
            const c = n.components.length ? `  [${n.components.join(', ')}]` : '';
            console.log(`  - ${n.path}${c}`);
        }
        console.log('');
    }

    if (result.onlyInB.length) {
        console.log(`【仅在 B 中存在的节点】 (${result.onlyInB.length})`);
        for (const n of result.onlyInB) {
            const c = n.components.length ? `  [${n.components.join(', ')}]` : '';
            console.log(`  + ${n.path}${c}`);
        }
        console.log('');
    }

    if (result.componentDiffs.length) {
        console.log(`【组件差异】 (${result.componentDiffs.length} 个节点)`);
        for (const d of result.componentDiffs) {
            console.log(`  @ ${d.path}`);
            if (d.onlyInA.length) {
                console.log(`      仅 A: ${d.onlyInA.join(', ')}`);
            }
            if (d.onlyInB.length) {
                console.log(`      仅 B: ${d.onlyInB.join(', ')}`);
            }
            console.log(`      A = [${d.a.join(', ')}]`);
            console.log(`      B = [${d.b.join(', ')}]`);
        }
        console.log('');
    }

    if (options.compareProps && result.propDiffs.length) {
        console.log(`【组件属性差异】 (${result.propDiffs.length} 个节点)`);
        for (const pd of result.propDiffs) {
            console.log(`  @ ${pd.path}`);
            for (const d of pd.diffs) {
                console.log(`      [${d.type}]`);
                for (const c of d.changed) {
                    console.log(`        ${c.key}:`);
                    console.log(`          A: ${JSON.stringify(c.a)}`);
                    console.log(`          B: ${JSON.stringify(c.b)}`);
                }
            }
        }
        console.log('');
    }

    console.log('-'.repeat(60));
    console.log(
        `汇总: 仅A节点 ${result.onlyInA.length}, 仅B节点 ${result.onlyInB.length}, ` +
        `组件差异节点 ${result.componentDiffs.length}` +
        (options.compareProps ? `, 属性差异节点 ${result.propDiffs.length}` : '')
    );
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help || args.files.length < 2) {
        printHelp();
        process.exit(args.help ? 0 : 1);
    }

    const [fileA, fileB] = args.files;
    const objectsA = loadPrefab(fileA);
    const objectsB = loadPrefab(fileB);
    const treeA = buildTree(objectsA);
    const treeB = buildTree(objectsB);

    if (!args.json) {
        console.log('\n--- Prefab A 树 ---');
        printTree(treeA);
        console.log('\n--- Prefab B 树 ---');
        printTree(treeB);
        console.log('');
    }

    const result = compareTrees(treeA, treeB, { compareProps: args.props });

    if (args.json) {
        console.log(JSON.stringify({
            fileA: path.resolve(fileA),
            fileB: path.resolve(fileB),
            ...result,
        }, null, 2));
    } else {
        printReport(result, fileA, fileB, { compareProps: args.props });
    }

    process.exit(result.identical ? 0 : 2);
}

main();
