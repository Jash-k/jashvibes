/**
 * check-source.cjs — resolves every import in the tree, and now checks the *names*
 * it imports actually exist.
 *
 * Two failure modes this catches before a build:
 *   1. a path that points nowhere      (`@/lib/typo`)         — as before;
 *   2. a named import that is not exported by the target file  — new, and it had
 *      already slipped through once: `components/admin/LyricsTab.js` imported
 *      `lyricsSongKey` from `lib/lyricsMatch.js`, where it does not exist (it lives
 *      in the server-side `lib/lyricsStore.js`). Webpack only warned — the key
 *      preview in Admin rendered `undefined`.
 *
 * Exported names are collected from `export const/function/class`, `export { a, b as c }`,
 * `export default`, and re-exports. A file with `export *` is treated as opaque (we cannot
 * know what it re-exports), so those imports are never flagged. `export default` counts as
 * satisfying the name `default` only.
 *
 * Output stays one line on success so it can sit inside `npm run verify`.
 */
const fs = require('fs');
const path = require('path');
const babel = require('next/dist/compiled/babel/core');

const SKIP_DIRS = ['node_modules', '.git', '.next', 'test-results', 'playwright-report'];
const PARSER_OPTS = { sourceType: 'module', babelrc: false, configFile: false, parserOpts: { plugins: ['jsx'] } };

let count = 0;
const issues = [];
const exportsByFile = new Map();
const importsByFile = new Map();

function resolve(from, spec) {
  const base = spec.startsWith('@/') ? path.resolve(spec.slice(2)) : path.resolve(path.dirname(from), spec);
  return [base, base + '.js', base + '.jsx', base + '.mjs', path.join(base, 'index.js')].find((p) => fs.existsSync(p) && fs.statSync(p).isFile());
}

function exportedNames(ast) {
  const names = new Set();
  let opaque = false;
  for (const node of ast.program.body) {
    if (node.type === 'ExportAllDeclaration') { opaque = true; continue; }
    if (node.type === 'ExportNamedDeclaration') {
      if (node.declaration) {
        const decl = node.declaration;
        if (decl.declarations) for (const d of decl.declarations) {
          // `export const { a, b } = obj` binds pattern names
          const collect = (id) => {
            if (!id) return;
            if (id.type === 'Identifier') names.add(id.name);
            else if (id.type === 'ObjectPattern') for (const prop of id.properties) collect(prop.value || prop.argument);
            else if (id.type === 'ArrayPattern') for (const el of id.elements) collect(el);
          };
          collect(d.id);
        } else if (decl.id?.name) names.add(decl.id.name);
      }
      for (const spec of node.specifiers || []) names.add((spec.exported || spec.local).name);
      if (node.source) opaque = true; // `export { x } from '…'` — assume valid
    }
  }
  return { names, opaque };
}

function walk(folder) {
  for (const item of fs.readdirSync(folder, { withFileTypes: true })) {
    if (SKIP_DIRS.includes(item.name)) continue;
    const file = path.join(folder, item.name);
    if (item.isDirectory()) { walk(file); continue; }
    if (!/\.(js|jsx|mjs)$/.test(file)) continue;
    count += 1;
    let ast;
    try {
      ast = babel.parseSync(fs.readFileSync(file, 'utf8'), PARSER_OPTS);
    } catch (error) {
      issues.push(`${file}: ${error.message}`);
      continue;
    }
    exportsByFile.set(path.resolve(file), exportedNames(ast));
    const wanted = [];
    for (const node of ast.program.body) {
      if (node.type !== 'ImportDeclaration') continue;
      const spec = node.source.value;
      if (!spec.startsWith('@/') && !spec.startsWith('.')) continue;
      const target = resolve(file, spec);
      if (!target) { issues.push(`${file}: unresolved ${spec}`); continue; }
      for (const s of node.specifiers) if (s.type === 'ImportSpecifier') wanted.push({ name: (s.imported || s.local).name, spec });
    }
    if (wanted.length) importsByFile.set(path.resolve(file), wanted);
  }
}

walk('.');
for (const [file, wanted] of importsByFile) {
  for (const { name, spec } of wanted) {
    const target = resolve(file, spec);
    const known = target && exportsByFile.get(path.resolve(target));
    if (!known || known.opaque) continue; // opaque or unparseable: not our call
    if (name === 'default') continue;    // default presence is a build-time concern
    if (!known.names.has(name)) {
      issues.push(`${file}: '${name}' is not exported by ${spec}`);
    }
  }
}

console.log(`${count} source modules checked`);
for (const issue of issues) console.error(issue);
process.exitCode = issues.length ? 1 : 0;
