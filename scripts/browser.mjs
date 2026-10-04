import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
const require=createRequire(import.meta.url);
let playwright;
try {playwright=require('playwright');} catch {
  const bundle=join(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
  playwright=require(process.env.PLAYWRIGHT_MODULE || bundle);
}
export async function browser() {
  const chrome=process.env.BROWSER_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  return playwright.chromium.launch({headless:true,...(existsSync(chrome)?{executablePath:chrome}:{})});
}
