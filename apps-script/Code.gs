const APP_CONFIG = Object.freeze({
  spreadsheetId: '1MhHItBfgSS9HFKwMeJDxmn8SKnmTZ-Q02aYAwfK1R8k',
  dataSheetName: 'Participants',
  imageFolderName: 'Lucky Wheel Images',
  spreadsheetProperty: 'LUCKY_WHEEL_SPREADSHEET_ID',
  imageFolderProperty: 'LUCKY_WHEEL_IMAGE_FOLDER_ID',
  maxItemsPerSession: 120,
  maxImageBytes: 5 * 1024 * 1024,
  sessionTitles: ['الجلسة الأولى', 'الجلسة الثانية', 'الجلسة الثالثة'],
});

const DATA_HEADERS = [
  'session_index',
  'position',
  'item_id',
  'name',
  'image_file_id',
  'updated_at',
];

/**
 * Run once from the Apps Script editor. This safely creates the data sheet and
 * image folder, then remembers their IDs for all future web-app requests.
 */
function setup() {
  const spreadsheet = SpreadsheetApp.openById(APP_CONFIG.spreadsheetId);

  const properties = PropertiesService.getScriptProperties();
  properties.setProperty(APP_CONFIG.spreadsheetProperty, spreadsheet.getId());

  let dataSheet = spreadsheet.getSheetByName(APP_CONFIG.dataSheetName);
  if (!dataSheet) {
    const firstSheet = spreadsheet.getSheets()[0];
    const firstSheetIsBlank = spreadsheet.getSheets().length === 1
      && firstSheet.getLastRow() <= 1
      && firstSheet.getLastColumn() <= 1
      && firstSheet.getRange('A1').isBlank();

    if (firstSheetIsBlank) {
      dataSheet = firstSheet;
      dataSheet.setName(APP_CONFIG.dataSheetName);
    } else {
      dataSheet = spreadsheet.insertSheet(APP_CONFIG.dataSheetName);
    }
  }

  ensureDataSheet_(dataSheet);

  let folder = getStoredImageFolder_();
  if (!folder) {
    folder = DriveApp.createFolder(APP_CONFIG.imageFolderName);
    properties.setProperty(APP_CONFIG.imageFolderProperty, folder.getId());
  }

  return {
    ok: true,
    spreadsheetName: spreadsheet.getName(),
    sheetName: dataSheet.getName(),
    imageFolderName: folder.getName(),
  };
}

function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('عجلة الحظ | اختيار عادل وممتع')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0');
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/** Returns all three sessions without embedding image bytes. */
function getAppData() {
  const sheet = getDataSheet_();
  const sessions = APP_CONFIG.sessionTitles.map((title, index) => ({
    id: `session-${index + 1}`,
    title,
    items: [],
  }));

  const rowCount = sheet.getLastRow() - 1;
  if (rowCount <= 0) return { sessions };

  const rows = sheet.getRange(2, 1, rowCount, DATA_HEADERS.length).getValues();
  rows.forEach((row) => {
    const sessionIndex = Number(row[0]);
    if (!Number.isInteger(sessionIndex) || sessionIndex < 0 || sessionIndex >= sessions.length) return;

    const id = String(row[2] || '').trim();
    const name = String(row[3] || '').trim().slice(0, 40);
    const imageId = String(row[4] || '').trim() || null;
    if (!id || (!name && !imageId)) return;

    sessions[sessionIndex].items.push({
      id,
      name,
      imageId,
      position: Number(row[1]) || 0,
    });
  });

  sessions.forEach((session) => {
    session.items.sort((left, right) => left.position - right.position);
    session.items.forEach((item) => delete item.position);
  });

  return { sessions };
}

/** Replaces the small participant table in one atomic, locked operation. */
function saveSessions(input) {
  const sessions = normalizeSessions_(input);
  const rows = [];
  const now = new Date();

  sessions.forEach((session, sessionIndex) => {
    session.items.forEach((item, position) => {
      rows.push([
        sessionIndex,
        position,
        item.id,
        item.name,
        item.imageId || '',
        now,
      ]);
    });
  });

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = getDataSheet_();
    const oldRowCount = Math.max(0, sheet.getLastRow() - 1);
    if (oldRowCount) sheet.getRange(2, 1, oldRowCount, DATA_HEADERS.length).clearContent();
    if (rows.length) sheet.getRange(2, 1, rows.length, DATA_HEADERS.length).setValues(rows);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }

  return { ok: true, itemCount: rows.length };
}

/** Saves one browser-compressed picture and returns its private Drive file ID. */
function uploadImage(payload) {
  if (!payload || typeof payload.base64 !== 'string') {
    throw new Error('No image data was received.');
  }

  const mimeType = String(payload.mimeType || '').toLowerCase();
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
    throw new Error('Unsupported image format.');
  }

  const bytes = Utilities.base64Decode(payload.base64);
  if (!bytes.length || bytes.length > APP_CONFIG.maxImageBytes) {
    throw new Error('The processed image is too large.');
  }

  const extension = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
  const filename = `wheel-${Date.now()}-${Utilities.getUuid()}.${extension}`;
  const blob = Utilities.newBlob(bytes, mimeType, filename);
  const file = getImageFolder_().createFile(blob);
  file.setDescription('Lucky Wheel participant image');
  return { id: file.getId() };
}

/** Returns a private Drive picture as a browser-ready data URL. */
function getImageData(fileId) {
  const file = getManagedFile_(fileId);
  const blob = file.getBlob();
  const bytes = blob.getBytes();
  if (bytes.length > APP_CONFIG.maxImageBytes) throw new Error('Image file is too large.');
  return `data:${blob.getContentType()};base64,${Utilities.base64Encode(bytes)}`;
}

/** Permanently removes one image owned by this app. */
function deleteImage(fileId) {
  if (!fileId) return { ok: true };
  getManagedFile_(fileId);
  Drive.Files.remove(String(fileId));
  return { ok: true };
}

function deleteImages(fileIds) {
  const uniqueIds = [...new Set((Array.isArray(fileIds) ? fileIds : []).filter(Boolean).map(String))];
  const failures = [];
  uniqueIds.forEach((fileId) => {
    try {
      deleteImage(fileId);
    } catch (error) {
      failures.push({ fileId, message: error.message });
    }
  });
  return { ok: failures.length === 0, deleted: uniqueIds.length - failures.length, failures };
}

function ensureDataSheet_(sheet) {
  const currentHeaders = sheet.getRange(1, 1, 1, DATA_HEADERS.length).getValues()[0];
  if (currentHeaders.join('|') !== DATA_HEADERS.join('|')) {
    if (sheet.getLastRow() > 1 || currentHeaders.some(Boolean)) {
      throw new Error(`The sheet named "${APP_CONFIG.dataSheetName}" already contains unrelated data.`);
    }
    sheet.getRange(1, 1, 1, DATA_HEADERS.length).setValues([DATA_HEADERS]);
  }

  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, DATA_HEADERS.length)
    .setFontWeight('bold')
    .setBackground('#1b2340')
    .setFontColor('#ffffff');
  sheet.setColumnWidths(1, DATA_HEADERS.length, 150);
  sheet.setColumnWidth(4, 220);
}

function normalizeSessions_(input) {
  if (!Array.isArray(input) || input.length !== APP_CONFIG.sessionTitles.length) {
    throw new Error('The session data is invalid.');
  }

  return input.map((session, sessionIndex) => {
    const rawItems = Array.isArray(session && session.items) ? session.items : [];
    if (rawItems.length > APP_CONFIG.maxItemsPerSession) {
      throw new Error(`Session ${sessionIndex + 1} contains too many items.`);
    }

    const seenIds = new Set();
    const items = rawItems.map((item) => {
      const id = String(item && item.id || '').trim().slice(0, 100);
      const name = String(item && item.name || '').trim().replace(/\s+/g, ' ').slice(0, 40);
      const imageId = String(item && item.imageId || '').trim().slice(0, 200) || null;
      if (!id || seenIds.has(id) || (!name && !imageId)) throw new Error('An item is invalid.');
      seenIds.add(id);
      return { id, name, imageId };
    });

    return {
      id: `session-${sessionIndex + 1}`,
      title: APP_CONFIG.sessionTitles[sessionIndex],
      items,
    };
  });
}

function getSpreadsheet_() {
  const spreadsheetId = PropertiesService.getScriptProperties().getProperty(APP_CONFIG.spreadsheetProperty);
  if (!spreadsheetId) throw new Error('Run setup from the Apps Script editor first.');
  return SpreadsheetApp.openById(spreadsheetId);
}

function getDataSheet_() {
  const sheet = getSpreadsheet_().getSheetByName(APP_CONFIG.dataSheetName);
  if (!sheet) throw new Error('The participant data sheet is missing. Run setup again.');
  return sheet;
}

function getStoredImageFolder_() {
  const folderId = PropertiesService.getScriptProperties().getProperty(APP_CONFIG.imageFolderProperty);
  if (!folderId) return null;
  try {
    return DriveApp.getFolderById(folderId);
  } catch (error) {
    return null;
  }
}

function getImageFolder_() {
  const folder = getStoredImageFolder_();
  if (!folder) throw new Error('The image folder is missing. Run setup again.');
  return folder;
}

function getManagedFile_(fileId) {
  const id = String(fileId || '').trim();
  if (!id) throw new Error('The image ID is missing.');

  const file = DriveApp.getFileById(id);
  const expectedFolderId = getImageFolder_().getId();
  const parents = file.getParents();
  let belongsToApp = false;
  while (parents.hasNext()) {
    if (parents.next().getId() === expectedFolderId) {
      belongsToApp = true;
      break;
    }
  }
  if (!belongsToApp) throw new Error('This file is not managed by Lucky Wheel.');
  return file;
}
