// Checks the release build in release/unpacked and packs it into release/<slug>-<version>.zip: the file that is
// uploaded to the Chrome Web Store. Run it through `npm run package`, which does the typecheck, the unit tests
// and the release build first.
//   --draft   pack even though required links or the LICENSE are still missing, as …-draft.zip
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pngInfo } from './lib/png.mjs';
import { readZip, writeZip } from './lib/zip.mjs';

const draft = process.argv.includes('--draft');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const releaseDir = path.join(root, 'release');
const unpacked = path.join(releaseDir, 'unpacked');

/** What the extension is allowed to ask for. A new permission is a decision, not a side effect of a change. */
const EXPECTED_PERMISSIONS = ['alarms', 'idle', 'notifications', 'scripting', 'storage', 'unlimitedStorage'];
const EXPECTED_HOSTS = ['*://*.youtube-nocookie.com/*', '*://*.youtube.com/*'];
/** Links the store listing and the About card cannot do without. */
const REQUIRED_LINKS = ['privacy', 'source'];

const problems = [];
/** Things that are only acceptable in a draft package. */
const pending = [];

const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

async function walk(dir, base = dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full, base)));
    else out.push({ name: path.relative(base, full).split(path.sep).join('/'), full });
  }
  return out;
}

const pkg = await readJson(path.join(root, 'package.json'));
const brand = await readJson(path.join(root, 'src', 'shared', 'brand.json'));
let files;
try {
  files = await walk(unpacked);
} catch {
  console.error('release/unpacked does not exist: run `npm run package`, not this script on its own.');
  process.exit(1);
}
const names = new Set(files.map((f) => f.name));
const manifest = await readJson(path.join(unpacked, 'manifest.json'));

// ---- manifest ---------------------------------------------------------------------------------------------
if (manifest.manifest_version !== 3) problems.push('manifest_version is not 3');
if (manifest.name !== brand.name) problems.push(`manifest name "${manifest.name}" differs from brand.json`);
if (manifest.description !== brand.summary) problems.push('manifest description differs from brand.json summary');
if ([...manifest.name].length > 75) problems.push(`name is ${[...manifest.name].length} characters (store limit 75)`);
if ([...manifest.description].length > 132) problems.push(`summary is ${[...manifest.description].length} characters (store limit 132)`);
if (manifest.version !== pkg.version) problems.push(`manifest version ${manifest.version} differs from package.json ${pkg.version}`);
if (!/^\d+(\.\d+){0,3}$/.test(manifest.version)) problems.push(`version "${manifest.version}" is not a Chrome version number`);
if (!same(manifest.permissions ?? [], EXPECTED_PERMISSIONS)) problems.push(`permissions are [${manifest.permissions}] but [${EXPECTED_PERMISSIONS}] are expected`);
if (!same(manifest.host_permissions ?? [], EXPECTED_HOSTS)) problems.push(`host_permissions are [${manifest.host_permissions}] but [${EXPECTED_HOSTS}] are expected`);
if (manifest.optional_permissions || manifest.optional_host_permissions) problems.push('optional permissions were added: review them and update this script');
for (const key of ['key', 'update_url']) if (key in manifest) problems.push(`manifest contains "${key}", which the store does not accept`);

const referenced = [
  manifest.background?.service_worker,
  manifest.action?.default_popup,
  manifest.options_page,
  ...Object.values(manifest.icons ?? {}),
  ...Object.values(manifest.action?.default_icon ?? {}),
  ...(manifest.content_scripts ?? []).flatMap((c) => c.js ?? []),
  ...(manifest.web_accessible_resources ?? []).flatMap((r) => r.resources ?? []),
];
for (const ref of referenced) if (!ref || !names.has(ref)) problems.push(`manifest refers to a missing file: ${ref}`);

for (const [size, file] of Object.entries(manifest.icons ?? {})) {
  const info = names.has(file) ? pngInfo(await readFile(path.join(unpacked, file))) : null;
  if (!info || info.width !== Number(size) || info.height !== Number(size)) problems.push(`${file} is not a ${size}x${size} PNG`);
}
if (!manifest.icons?.['128']) problems.push('there is no 128 px icon');

// ---- contents ---------------------------------------------------------------------------------------------
for (const f of files) {
  if (f.name.endsWith('.map')) problems.push(`source map in the package: ${f.name}`);
  if (!f.name.endsWith('.js')) continue;
  const text = await readFile(f.full, 'utf8');
  if (text.includes('sourceMappingURL')) problems.push(`${f.name} carries a source map (was the last build a --watch build?)`);
  if (text.includes('__ytbTest')) problems.push(`${f.name} contains the e2e test hook: this is not a --release build`);
  if (/\beval\s*\(|new Function\s*\(/.test(text)) problems.push(`${f.name} evaluates code from strings, which the store rejects`);
}

// ---- links and license ------------------------------------------------------------------------------------
for (const [key, url] of Object.entries(brand.links)) {
  if (url !== '' && !url.startsWith('https://')) problems.push(`brand.json link "${key}" is not an https URL`);
}
for (const key of REQUIRED_LINKS) if (!brand.links[key]) pending.push(`brand.json link "${key}" is empty`);
if (!brand.links.tips) console.log('note: no tips link is set, so the Ko-fi button and sentence are not shown.');
let license = null;
try {
  license = await readFile(path.join(root, 'LICENSE'));
} catch {
  pending.push('there is no LICENSE file');
}

// The privacy policy is what the store listing links to: it has to exist before a package is built for upload.
try {
  await readFile(path.join(root, 'PRIVACY.md'));
} catch {
  pending.push('there is no PRIVACY.md');
}

if (pending.length && !draft) problems.push(...pending.map((p) => `${p} (use --draft to pack anyway)`));

if (problems.length) {
  console.error(`\nNot packaged, ${problems.length} problem(s):\n` + problems.map((p) => `  - ${p}`).join('\n'));
  process.exit(1);
}

// ---- pack and verify --------------------------------------------------------------------------------------
const entries = [];
for (const f of files) entries.push({ name: f.name, data: await readFile(f.full) });
if (license) entries.push({ name: 'LICENSE', data: license });
const zip = writeZip(entries);

const back = new Map(readZip(zip).map((e) => [e.name, e.data]));
if (back.size !== entries.length) throw new Error('the archive does not contain every file');
for (const e of entries) {
  if (!back.get(e.name)?.equals(e.data)) throw new Error(`${e.name} did not survive the round trip`);
}
if (!back.has('manifest.json')) throw new Error('manifest.json is not at the root of the archive');

await mkdir(releaseDir, { recursive: true });
const zipName = `${brand.slug}-${manifest.version}${draft && pending.length ? '-draft' : ''}.zip`;
await writeFile(path.join(releaseDir, zipName), zip);
console.log(`\nrelease/${zipName}`);
console.log(`  ${entries.length} files, ${(zip.length / 1024).toFixed(1)} KB, sha256 ${createHash('sha256').update(zip).digest('hex')}`);
console.log(`  ${manifest.name} ${manifest.version}; permissions: ${[...manifest.permissions].sort().join(', ')}; hosts: ${[...manifest.host_permissions].sort().join(', ')}`);
if (draft && pending.length) {
  console.log('\nDRAFT, not for upload. Still missing:\n' + pending.map((p) => `  - ${p}`).join('\n'));
}
