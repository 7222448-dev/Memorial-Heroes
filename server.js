const express = require('express');
const session = require('express-session');
const SqliteStore = require('better-sqlite3-session-store')(session);
const cookieParser = require('cookie-parser');
const path = require('path');
const { initDatabase } = require('./db/init');
const { startBackupScheduler } = require('./db/backup');
const { UPLOADS_DIR, useVolume, VOLUME_DIR } = require('./db/paths');
const { doubleCsrfProtection, generateCsrfToken } = require('./middleware/csrf');

const app = express();
const PORT = process.env.PORT || 3000;

// Для коректної роботи rate-limit та secure-cookie за reverse-proxy (Nginx, Railway, Render)
app.set('trust proxy', 1);

async function start() {
  const db = await initDatabase();
  console.log('✅ База даних підключена');

  // ─── Базові middleware ────────────────────────────────────────
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  app.use(cookieParser(process.env.SESSION_SECRET || 'memorial-heroes-ua-secret-change-me'));
  app.use(express.static(path.join(__dirname, 'public')));
  // /uploads віддаємо з UPLOADS_DIR — на Railway з Volume це постійне сховище,
  // локально — public/uploads. Те саме URL у обох випадках.
  app.use('/uploads', express.static(UPLOADS_DIR));

  // Сесії зберігаємо у тій же SQLite-БД, що й героїв.
  // Це:
  //  1) Прибирає production-warning від MemoryStore
  //  2) Сесії переживають redeploy/перезапуск (на Railway з Volume — взагалі завжди)
  //  3) Працює стабільно навіть якщо Railway запускає декілька процесів
  app.use(session({
    name: 'memorial.sid',
    secret: process.env.SESSION_SECRET || 'memorial-heroes-ua-secret-change-me',
    resave: false,
    saveUninitialized: false,
    store: new SqliteStore({
      client: db._raw,            // той самий better-sqlite3 instance
      expired: {
        clear: true,
        intervalMs: 15 * 60 * 1000, // прибирати протухлі сесії раз на 15 хв
      },
    }),
    cookie: {
      maxAge: 24 * 60 * 60 * 1000,
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    },
  }));

  app.use((req, res, next) => { req.db = db; next(); });

  // ─── Публічна точка для отримання CSRF-токену (потрібна адмін-фронту) ─
  // ВАЖЛИВО: csrf-csrf прив'язує токен до req.sessionID. Якщо нічого не записати
  // в сесію — з saveUninitialized:false вона не збережеться, sessionID не зафіксується
  // в cookie, і на наступному запиті буде новий ID → CSRF-токен стане невалідним
  // ("Сесія минула. Оновіть сторінку."). Тому форсимо збереження сесії.
  app.get('/admin/csrf-token', (req, res, next) => {
    req.session.csrfInit = true;
    req.session.save((err) => {
      if (err) return next(err);
      const token = generateCsrfToken(req, res);
      res.json({ csrfToken: token });
    });
  });

  // ─── Маршрути ─────────────────────────────────────────────────
  app.use('/api', require('./routes/api'));

  // Усі мутації /admin/* захищені CSRF. Винятки — лише GET-сторінки
  // та сам логін (логін захищаємо окремо через rate-limit + бекенд-перевірку),
  // тому що ще немає сесії.
  app.use('/admin', (req, res, next) => {
    const safeMethod = ['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    const isLogin = req.path === '/login';
    if (safeMethod || isLogin) return next();
    return doubleCsrfProtection(req, res, next);
  }, require('./routes/admin'));

  // ─── SPA-роутинг для публічного сайту ─────────────────────────
  app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
  app.get('/hero/:id', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

  // ─── Обробник помилок (зокрема CSRF) ──────────────────────────
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err?.code === 'EBADCSRFTOKEN') {
      return res.status(403).json({ error: 'Сесія минула. Оновіть сторінку.' });
    }
    console.error('Server error:', err);
    res.status(500).json({ error: 'Внутрішня помилка сервера' });
  });

  app.listen(PORT, () => {
    console.log(`\n🕯️  Книга Пам'яті: http://localhost:${PORT}`);
    console.log(`📋 Адмін-панель:   http://localhost:${PORT}/admin`);
    if (useVolume) {
      console.log(`💾 Volume підключено: ${VOLUME_DIR} (дані переживуть redeploy)`);
    } else {
      console.log(`📁 Локальне сховище (без Volume) — дані можуть бути втрачені при redeploy`);
    }
    console.log('');
  });

  // Авто-бекапи стартують після підняття сервера
  startBackupScheduler(db);
}

// Не запускаємо у тестовому режимі — там сервер створюється окремо
if (require.main === module) {
  start().catch(e => { console.error('Помилка запуску:', e); process.exit(1); });
}

module.exports = { start };
