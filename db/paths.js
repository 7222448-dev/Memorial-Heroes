// db/paths.js — централізоване визначення шляхів зберігання.
//
// Логіка:
//  • На Railway: змінна RAILWAY_VOLUME_MOUNT_PATH встановлюється автоматично,
//    коли до сервісу прикріплено Volume. Тоді все живе там — БД, бекапи, фото.
//  • Локально: використовуються стандартні шляхи всередині проекту,
//    які ігноруються git-ом (.gitignore).
//  • Можна примусово задати DATA_DIR — корисно для тестів або інших хостингів.
//
// Експортує готові абсолютні шляхи. Усі директорії створюються автоматично
// на першому require — щоб ніде потім не довелось перевіряти існування.

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..');

// Пріоритет: явна змінна DATA_DIR > Railway Volume > локальний проект
const VOLUME_DIR = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || null;

let useVolume = false;
if (VOLUME_DIR) {
  try {
    fs.mkdirSync(VOLUME_DIR, { recursive: true });
    useVolume = fs.statSync(VOLUME_DIR).isDirectory();
  } catch (e) {
    console.warn(`⚠️  Volume path ${VOLUME_DIR} недоступний, використовую локальне сховище:`, e.message);
    useVolume = false;
  }
}

let DB_PATH, BACKUP_DIR, UPLOADS_DIR;

if (useVolume) {
  DB_PATH = path.join(VOLUME_DIR, 'memorial.db');
  BACKUP_DIR = path.join(VOLUME_DIR, 'backups');
  UPLOADS_DIR = path.join(VOLUME_DIR, 'uploads');
} else {
  DB_PATH = path.join(PROJECT_ROOT, 'db', 'memorial.db');
  BACKUP_DIR = path.join(PROJECT_ROOT, 'db', 'backups');
  UPLOADS_DIR = path.join(PROJECT_ROOT, 'public', 'uploads');
}

// Створюємо всі потрібні директорії одразу (для першого запуску)
[
  path.dirname(DB_PATH),
  BACKUP_DIR,
  UPLOADS_DIR,
  path.join(UPLOADS_DIR, 'photos'),
  path.join(UPLOADS_DIR, 'audio'),
  path.join(UPLOADS_DIR, 'video'),
].forEach(dir => {
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { /* ignore */ }
});

module.exports = {
  DB_PATH,
  BACKUP_DIR,
  UPLOADS_DIR,
  useVolume,
  VOLUME_DIR,
};
