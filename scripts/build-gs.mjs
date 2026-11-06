// Generates apps-script/Code.gs from the template + src/sync/merge.js, so the
// backend and the web app always run the same merge code.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
export function buildGs() {
  const tpl = fs.readFileSync(root + 'apps-script/Code.template.gs', 'utf8');
  const merge = fs.readFileSync(root + 'src/sync/merge.js', 'utf8').replace(/^export /gm, '');
  return tpl.replace('/*__MERGE__*/', merge.trim() + '\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fs.writeFileSync(root + 'apps-script/Code.gs', buildGs());
  console.log('wrote apps-script/Code.gs');
}
