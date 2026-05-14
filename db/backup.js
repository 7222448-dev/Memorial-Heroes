// db/backup.js — автоматичне резервне копіювання БД
//
// Як працює:
//  • При старті сервера планує перший бекап через 1 хвилину
//   (даємо серверу прогрітись, не блокуючи запуск)
//  • Далі — раз на 24 години
//  • Файли зберігаються у db/backups/memorial-YYYY-MM-DD.db
//  • Тримаємо останні N бекапів (за замовчуванням 14), старші — видаляємо
//
// Використовує API better-sqlite3 .backup() — атомарний копір без блокування записів.
const fs = require('fs');
const path = require('path');

const BACKUP_DIR = path.join(__dirname, 'backups');
const KEEP_COUNT = parseInt(process.env.BACKUP_KEEP || '14', 10);
const INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 години
const INITIAL_DELAY_MS = 60 * 1000;       // 1 хвилина після старту

function todayStamp() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function performBackup(db) {
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const dest = path.join(BACKUP_DIR, `memorial-${todayStamp()}.db`);
    // db._raw — реальний інстанс better-sqlite3
    await db._raw.backup(dest);
    console.log(`📦 Бекап БД створено: ${path.basename(dest)}`);
    rotate();
  } catch (e) {
    console.error('❌ Помилка створення бекапу:', e.message);
  }
}

function rotate() {
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => /^memorial-\d{4}-\d{2}-\d{2}\.db$/.test(f))
      .map(f => ({ name: f, path: path.join(BACKUP_DIR, f) }))
      .sort((a, b) => a.name.localeCompare(b.name)); // лексикографічне = хронологічне

    const toDelete = files.slice(0, Math.max(0, files.length - KEEP_COUNT));
    toDelete.forEach(f => {
      try {
        fs.unlinkSync(f.path);
        console.log(`🗑  Видалено старий бекап: ${f.name}`);
      } catch (e) { /* ignore */ }
    });
  } catch (e) { /* ignore — папки може ще не бути */ }
}

function startBackupScheduler(db) {
  // Не запускаємо в тестовому режимі
  if (process.env.NODE_ENV === 'test' || process.env.DISABLE_BACKUPS === '1') return;

  setTimeout(() => {
    performBackup(db);
    setInterval(() => performBackup(db), INTERVAL_MS);
  }, INITIAL_DELAY_MS);

  console.log(`🛡  Авто-бекапи увімкнено (раз на добу, зберігаємо ${KEEP_COUNT} останніх)`);
}

module.exports = { startBackupScheduler, performBackup, BACKUP_DIR };
