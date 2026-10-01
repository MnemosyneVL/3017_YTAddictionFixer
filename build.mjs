// Build script: bundles the extension with esbuild and copies static assets.
// Usage: node build.mjs [--watch] [--release] [--outdir <dir>]
//   --release   the build that goes to the Chrome Web Store: without the e2e test hook
//   --outdir    where to write it (default: dist)
import { build, context } from 'esbuild';
import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const watch = args.includes('--watch');
const release = args.includes('--release');
const outArg = args.includes('--outdir') ? args[args.indexOf('--outdir') + 1] : undefined;
const root = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const dist = path.resolve(root, outArg ?? 'dist');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
/** Stamped into every bundle so the pages can detect a stale (not yet reloaded) service worker. */
const buildStamp = `${pkg.version}.${Date.now()}`;

const common = {
  define: { __BUILD__: JSON.stringify(buildStamp) },
  bundle: true,
  target: ['chrome120'],
  sourcemap: watch ? 'inline' : false,
  minify: false,
  logLevel: 'info',
  legalComments: 'none',
  absWorkingDir: root,
};

/**
 * Entry points. Content scripts and pages must be classic scripts (iife); the service worker is an ES module.
 * The development worker (index.dev.ts) is the release worker plus the hook the e2e harness talks to; the hook
 * is left out by entry point, so no trace of it is in a release build.
 */
const bundles = [
  { entryPoints: { background: release ? 'src/background/index.ts' : 'src/background/index.dev.ts' }, outdir: dist, format: 'esm' },
  { entryPoints: { content: 'src/content/index.ts', bridge: 'src/content/bridge.ts' }, outdir: dist, format: 'iife' },
  {
    entryPoints: {
      blocked: 'src/pages/blocked.ts',
      popup: 'src/pages/popup.ts',
      options: 'src/pages/options.ts',
      report: 'src/pages/report.ts',
      welcome: 'src/pages/welcome.ts',
    },
    outdir: path.join(dist, 'pages'),
    format: 'iife',
  },
];

async function copyStatic() {
  await cp(path.join(root, 'public'), dist, { recursive: true });
  // Keep manifest version in sync with package.json.
  const manifestPath = path.join(dist, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  let changed = false;
  if (manifest.version !== pkg.version) {
    console.warn(`manifest version ${manifest.version} != package.json ${pkg.version}; using package.json`);
    manifest.version = pkg.version;
    changed = true;
  }
  // The extension's "website" on chrome://extensions is the source repository, once that link is set.
  const brand = JSON.parse(await readFile(path.join(root, 'src', 'shared', 'brand.json'), 'utf8'));
  if (brand.links.source && manifest.homepage_url !== brand.links.source) {
    manifest.homepage_url = brand.links.source;
    changed = true;
  }
  if (changed) await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
}

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await copyStatic();

if (watch) {
  const contexts = await Promise.all(bundles.map((b) => context({ ...common, ...b })));
  await Promise.all(contexts.map((c) => c.watch()));
  console.log('watching for changes… (static files in public/ are copied only at start)');
} else {
  await Promise.all(bundles.map((b) => build({ ...common, ...b })));
  console.log(`${release ? 'release ' : ''}build complete → ${path.relative(root, dist) || '.'}/`);
}
