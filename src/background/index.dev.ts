// Service worker entry point of development builds: the real worker first (its listeners must be registered
// synchronously at top level), then the e2e test hook. `node build.mjs --release` uses index.ts directly.
import './index';
import './test-hook';
