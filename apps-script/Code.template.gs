/**
 * WorldAtlas sync backend — Google Apps Script web app.
 *
 * GENERATED FILE: edit apps-script/Code.template.gs or src/sync/merge.js,
 * then run `npm run build:gs`. Copy this whole file into your Apps Script
 * project (replacing Code.gs).
 *
 * Setup
 *   1. script.google.com -> New project -> paste this file as Code.gs.
 *   2. Change SYNC_KEY below to a long random string (it is your password;
 *      you will type the same key into WorldAtlas on each device).
 *   3. Deploy -> New deployment -> type "Web app".
 *        Execute as: Me
 *        Who has access: Anyone
 *      Authorize when asked (it needs Google Drive to store one JSON file).
 *   4. Copy the web app URL (ends in /exec) into WorldAtlas ->
 *      Settings -> Sync across devices, together with the SYNC_KEY.
 *   After editing this file later: Deploy -> Manage deployments -> Edit ->
 *   Version: New version, so the same URL keeps working.
 *
 * Data: one file, "worldatlas-sync.json", in the Drive of the account that
 * deployed the script. Requests without the right SYNC_KEY are rejected.
 * Merging happens here, under a script lock, so two devices syncing at the
 * same moment cannot overwrite each other.
 */

const SYNC_KEY = 'CHANGE-ME-to-a-long-random-string';
const FILE_NAME = 'worldatlas-sync.json';
const API_VERSION = 1;

function doGet(e) {
  return respond_(handle_((e && e.parameter) || {}));
}

function doPost(e) {
  let req;
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return respond_({ ok: false, error: 'Request body is not JSON' });
  }
  return respond_(handle_(req));
}

function handle_(req) {
  try {
    if (!SYNC_KEY || SYNC_KEY.indexOf('CHANGE-ME') === 0) {
      return { ok: false, error: 'Set SYNC_KEY in Code.gs, then deploy a new version.' };
    }
    if (req.key !== SYNC_KEY) return { ok: false, error: 'Wrong sync key' };
    const action = req.action || 'ping';
    if (action === 'ping') return { ok: true, api: API_VERSION };
    if (action === 'pull') return { ok: true, api: API_VERSION, doc: readDoc_() };
    if (action === 'sync') {
      const incoming = req.doc;
      if (!incoming || incoming.format !== WA_SYNC_FORMAT) return { ok: false, error: 'Missing or invalid doc' };
      const lock = LockService.getScriptLock();
      lock.waitLock(20000);
      try {
        const stored = readDoc_();
        const merged = waMerge(stored, incoming);
        if (!waSameDoc(stored, merged)) writeDoc_(merged);
        return { ok: true, api: API_VERSION, doc: merged };
      } finally {
        lock.releaseLock();
      }
    }
    return { ok: false, error: 'Unknown action: ' + action };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
}

function file_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('FILE_ID');
  if (id) {
    try {
      const f = DriveApp.getFileById(id);
      if (!f.isTrashed()) return f;
    } catch (err) {
      // file was deleted: create a new one below
    }
  }
  const created = DriveApp.createFile(FILE_NAME, JSON.stringify(waEmptyDoc()), 'application/json');
  props.setProperty('FILE_ID', created.getId());
  return created;
}

function readDoc_() {
  try {
    const doc = JSON.parse(file_().getBlob().getDataAsString());
    return doc && doc.format === WA_SYNC_FORMAT ? doc : waEmptyDoc();
  } catch (err) {
    return waEmptyDoc();
  }
}

function writeDoc_(doc) {
  file_().setContent(JSON.stringify(doc));
}

function respond_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ---- merge logic (shared with the web app: src/sync/merge.js) ----

/*__MERGE__*/
