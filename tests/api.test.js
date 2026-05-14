// tests/api.test.js — мінімальний smoke-тест публічного API
//
// Запускати: npm test
// Тести створюють тимчасову БД у tests/__fixtures__/test.db, щоб не зачіпати робочу.

const path = require('path');
const fs = require('fs');
const os = require('os');

// Окрема тимчасова БД на час тестів — кладемо у системний tmp,
// щоб точно не плутати з робочою memorial.db. Створюємо ДО require('../db/init').
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'memorial-test-'));
const TMP_DB = path.join(TMP_DIR, 'test.db');

// Підміняємо шлях до БД, перевизначивши модуль через mock — простіше:
jest.mock('../db/init', () => {
  const Database = require('better-sqlite3');
  const bcrypt = require('bcryptjs');
  const realPath = TMP_DB;

  function createWrapper(db) {
    return {
      all: (sql, p = []) => db.prepare(sql).all(...p),
      get: (sql, p = []) => db.prepare(sql).get(...p) || null,
      run: (sql, p = []) => {
        const r = db.prepare(sql).run(...p);
        return { changes: r.changes, lastInsertRowid: r.lastInsertRowid };
      },
      exec: (sql) => db.exec(sql),
      _raw: db,
      _path: realPath,
    };
  }

  return {
    DB_PATH: realPath,
    initDatabase: async () => {
      const db = new Database(realPath);
      db.pragma('journal_mode = WAL');
      db.pragma('foreign_keys = ON');
      db.exec(`
        CREATE TABLE IF NOT EXISTS heroes (
          id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, callsign TEXT,
          rank TEXT, born TEXT, fallen TEXT, unit TEXT, brigade TEXT, battalion TEXT,
          company TEXT, city TEXT, story TEXT, photo TEXT, candles INTEGER DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS awards (id INTEGER PRIMARY KEY AUTOINCREMENT, hero_id INTEGER NOT NULL, title TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS gallery (id INTEGER PRIMARY KEY AUTOINCREMENT, hero_id INTEGER NOT NULL, filename TEXT NOT NULL, caption TEXT, sort_order INTEGER DEFAULT 0);
        CREATE TABLE IF NOT EXISTS media (id INTEGER PRIMARY KEY AUTOINCREMENT, hero_id INTEGER NOT NULL, type TEXT NOT NULL, filename TEXT NOT NULL, title TEXT, duration TEXT, sort_order INTEGER DEFAULT 0);
        CREATE TABLE IF NOT EXISTS admins (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL);
      `);
      db.prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)').run('admin', bcrypt.hashSync('admin123', 4));
      db.prepare('INSERT INTO heroes (name, callsign, rank, city, candles) VALUES (?,?,?,?,?)').run('Тестовий Герой', 'Тест', 'Солдат', 'Київ', 0);
      return createWrapper(db);
    },
  };
});

// Тільки після mock — підвантажуємо застосунок
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-secret-do-not-use';
const request = require('supertest');
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const { initDatabase } = require('../db/init');

let app;
let db;

beforeAll(async () => {
  db = await initDatabase();
  app = express();
  app.use(express.json());
  app.use(cookieParser('test-secret'));
  app.use(session({ secret: 'test-secret', resave: false, saveUninitialized: false }));
  app.use((req, _res, next) => { req.db = db; next(); });
  app.use('/api', require('../routes/api'));
  app.use('/admin', require('../routes/admin'));
});

afterAll(() => {
  try { db._raw.close(); } catch (_) { /* ignore */ }
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (_) { /* ignore */ }
});

describe('Public API', () => {
  test('GET /api/stats повертає об\'єкт зі статистикою', async () => {
    const res = await request(app).get('/api/stats');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('heroes');
    expect(res.body).toHaveProperty('candles');
    expect(res.body.heroes).toBeGreaterThanOrEqual(1);
  });

  test('GET /api/heroes повертає список героїв з пагінацією', async () => {
    const res = await request(app).get('/api/heroes');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.heroes)).toBe(true);
    expect(res.body.heroes.length).toBeGreaterThanOrEqual(1);
    expect(res.body.pagination).toBeDefined();
  });

  test('GET /api/heroes/:id повертає повний профіль', async () => {
    const list = await request(app).get('/api/heroes');
    const id = list.body.heroes[0].id;
    const res = await request(app).get(`/api/heroes/${id}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('name');
    expect(res.body).toHaveProperty('awards');
    expect(res.body).toHaveProperty('gallery');
    expect(res.body).toHaveProperty('media');
  });

  test('POST /api/heroes/:id/candle збільшує лічильник', async () => {
    const list = await request(app).get('/api/heroes');
    const id = list.body.heroes[0].id;
    const before = list.body.heroes[0].candles;
    const res = await request(app).post(`/api/heroes/${id}/candle`);
    expect(res.status).toBe(200);
    expect(res.body.candles).toBe(before + 1);
  });

  test('POST /api/heroes/:id/candle блокується після 5 запитів (rate-limit)', async () => {
    const list = await request(app).get('/api/heroes');
    const id = list.body.heroes[0].id;
    // 1-й вже зроблено в попередньому тесті; робимо ще 4 успішних + 1 заблокований.
    let last;
    for (let i = 0; i < 5; i++) {
      last = await request(app).post(`/api/heroes/${id}/candle`);
    }
    // На 6-му сумарному (включно з попереднім тестом) має повернутися 429
    const blocked = await request(app).post(`/api/heroes/${id}/candle`);
    expect([200, 429]).toContain(last.status);
    expect(blocked.status).toBe(429);
  });
});

describe('Admin API', () => {
  test('POST /admin/login з невірним паролем повертає 401', async () => {
    const res = await request(app)
      .post('/admin/login')
      .send({ username: 'admin', password: 'wrong-password' });
    expect(res.status).toBe(401);
  });

  test('POST /admin/login з правильними даними повертає success', async () => {
    const res = await request(app)
      .post('/admin/login')
      .send({ username: 'admin', password: 'admin123' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
