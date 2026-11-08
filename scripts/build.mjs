import { mkdir, copyFile, readFile, writeFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'dist', 'jp-zh-live-lyrics');
await mkdir(path.join(root, 'vendor'), { recursive: true });
await mkdir(path.join(output, 'vendor'), { recursive: true });
await copyFile(path.join(root, 'node_modules/opencc-js/dist/esm/cn2t.js'), path.join(root, 'vendor/opencc-cn2t.mjs'));
for (const name of ['mod.json', 'client.mjs', 'core.mjs', 'translator.mjs', 'view.mjs', 'README.md', 'LICENSE', '來源與修改說明.md', '驗證紀錄.md', 'vendor/opencc-cn2t.mjs']) {
  await copyFile(path.join(root, name), path.join(output, name));
}
for (const name of ['LICENSE', 'THIRD_PARTY_LICENSES.md']) {
  const target = `vendor/opencc-${name}.txt`;
  await copyFile(path.join(root, 'node_modules/opencc-js', name), path.join(root, target));
  await copyFile(path.join(root, target), path.join(output, target));
}
const pkg = JSON.parse(await readFile(path.join(root, 'node_modules/opencc-js/package.json'), 'utf8'));
await writeFile(path.join(root, 'vendor/來源.txt'), `opencc-js ${pkg.version}\nhttps://github.com/nk2028/opencc-js\n來源：npm opencc-js@${pkg.version} dist/esm/cn2t.js，原始內容未修改，僅改副檔名為 .mjs。\n授權：MIT AND Apache-2.0，參閱同目錄授權全文。\n`, 'utf8');
await copyFile(path.join(root, 'vendor/來源.txt'), path.join(output, 'vendor/來源.txt'));
console.log(`Built ${output} (OpenCC ${pkg.version}, ${(await stat(path.join(output, 'vendor/opencc-cn2t.mjs'))).size} bytes)`);
