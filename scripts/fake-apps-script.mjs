// Runs apps-script/Code.gs in a Node VM with minimal fakes of the Apps Script
// services it uses (DriveApp, PropertiesService, LockService, ContentService).
// Used by unit tests and by the e2e sync check (as a stand-in web app).
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const CODE = fileURLToPath(new URL('../apps-script/Code.gs', import.meta.url));

export function loadAppsScript({ key = 'test-key', code = fs.readFileSync(CODE, 'utf8') } = {}) {
  const files = new Map();
  const props = new Map();
  let nextId = 1;
  const file = (id) => ({
    getId: () => id,
    isTrashed: () => false,
    getBlob: () => ({ getDataAsString: () => files.get(id) }),
    setContent: (s) => files.set(id, s),
  });
  const sandbox = {
    DriveApp: {
      createFile: (_name, content) => { const id = `f${nextId++}`; files.set(id, content); return file(id); },
      getFileById: (id) => { if (!files.has(id)) throw new Error('not found'); return file(id); },
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props.get(k) ?? null, setProperty: (k, v) => props.set(k, v) }) },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (s) => ({ content: s, setMimeType() { return this; } }),
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(code.replace("'CHANGE-ME-to-a-long-random-string'", JSON.stringify(key)), sandbox);
  return {
    post: (body) => JSON.parse(sandbox.doPost({ postData: { contents: body } }).content),
    get: (params) => JSON.parse(sandbox.doGet({ parameter: params }).content),
    stored: () => { const id = props.get('FILE_ID'); return id ? JSON.parse(files.get(id)) : null; },
  };
}
