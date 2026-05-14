// scripts/backup-now.js — створити бекап БД негайно з командного рядка.
// Запуск: npm run backup
const { initDatabase } = require('../db/init');
const { performBackup } = require('../db/backup');

(async () => {
  try {
    const db = await initDatabase();
    await performBackup(db);
    process.exit(0);
  } catch (e) {
    console.error('Помилка створення бекапу:', e);
    process.exit(1);
  }
})();
