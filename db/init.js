// db/init.js — надійне сховище на base of better-sqlite3
// Особливості:
//  • Реальна файлова SQLite-БД (а не in-memory + writeFileSync)
//  • WAL-режим: записи журналяться окремо, цілісність зберігається при збоях
//  • Synchronous = NORMAL: швидко й безпечно для одно-процесного сервера
//  • API-обгортка all/get/run/exec залишається сумісною з попереднім кодом
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const { DB_PATH } = require('./paths');

async function initDatabase() {
  // Директорії під DB вже створив paths.js

  const db = new Database(DB_PATH);

  // WAL + NORMAL — оптимальний компроміс надійності та швидкості
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');

  // ─── Схема ────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS heroes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      callsign TEXT,
      rank TEXT,
      born TEXT,
      fallen TEXT,
      unit TEXT,
      brigade TEXT,
      battalion TEXT,
      company TEXT,
      city TEXT,
      story TEXT,
      photo TEXT,
      candles INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS awards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hero_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      FOREIGN KEY (hero_id) REFERENCES heroes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS gallery (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hero_id INTEGER NOT NULL,
      filename TEXT NOT NULL,
      caption TEXT,
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (hero_id) REFERENCES heroes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS media (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hero_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      filename TEXT NOT NULL,
      title TEXT,
      duration TEXT,
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (hero_id) REFERENCES heroes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_heroes_name ON heroes(name);
    CREATE INDEX IF NOT EXISTS idx_heroes_brigade ON heroes(brigade);
    CREATE INDEX IF NOT EXISTS idx_heroes_battalion ON heroes(battalion);
    CREATE INDEX IF NOT EXISTS idx_heroes_company ON heroes(company);
    CREATE INDEX IF NOT EXISTS idx_awards_hero ON awards(hero_id);
    CREATE INDEX IF NOT EXISTS idx_gallery_hero ON gallery(hero_id);
    CREATE INDEX IF NOT EXISTS idx_media_hero ON media(hero_id);
  `);

  // ─── Міграції старих БД: додати колонки, якщо їх нема ──────
  const columns = db.prepare("PRAGMA table_info(heroes)").all().map(c => c.name);
  const ensure = (col, type = 'TEXT') => {
    if (!columns.includes(col)) {
      try { db.exec(`ALTER TABLE heroes ADD COLUMN ${col} ${type}`); } catch (e) { /* ignore */ }
    }
  };
  ensure('brigade');
  ensure('battalion');
  ensure('company');

  // ─── Адмін за замовчуванням ─────────────────────────────────
  const adminCount = db.prepare('SELECT COUNT(*) AS c FROM admins').get().c;
  if (adminCount === 0) {
    const hash = bcrypt.hashSync('admin123', 10);
    db.prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)').run('admin', hash);
    console.log('✅ Адмін створений: admin / admin123');
    console.log('⚠️  Змініть пароль після першого входу!');
  }

  return createWrapper(db);
}

// Обгортка зі старим API (all/get/run/exec) — щоб не довелось правити routes/*
function createWrapper(db) {
  return {
    all(sql, params = []) {
      try {
        const stmt = db.prepare(sql);
        return params.length ? stmt.all(...params) : stmt.all();
      } catch (e) {
        console.error('DB all:', e.message, '\nSQL:', sql);
        return [];
      }
    },
    get(sql, params = []) {
      try {
        const stmt = db.prepare(sql);
        const row = params.length ? stmt.get(...params) : stmt.get();
        return row || null;
      } catch (e) {
        console.error('DB get:', e.message, '\nSQL:', sql);
        return null;
      }
    },
    run(sql, params = []) {
      try {
        const stmt = db.prepare(sql);
        const info = params.length ? stmt.run(...params) : stmt.run();
        return {
          changes: info.changes,
          // Зберігаємо обидва імені для зворотної сумісності з кодом, що очікує lastInsertRowid
          lastInsertRowid: info.lastInsertRowid,
        };
      } catch (e) {
        console.error('DB run:', e.message, '\nSQL:', sql);
        return { changes: 0, lastInsertRowid: 0 };
      }
    },
    exec(sql) {
      try { db.exec(sql); } catch (e) { console.error('DB exec:', e.message); }
    },
    // Доступ до raw better-sqlite3 — корисно для бекапів та транзакцій
    _raw: db,
    // Шлях до файлу БД — потрібно модулю бекапів
    _path: DB_PATH,
  };
}

module.exports = { initDatabase, DB_PATH };
