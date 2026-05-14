const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const path = require('path');
const { initDatabase } = require('./db/init');
const { startBackupScheduler } = require('./db/backup');
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
  app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));

  app.use(session({
    name: 'memorial.sid',
    secret: process.env.SESSION_SECRET || 'memorial-heroes-ua-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 24 * 60 * 60 * 1000,
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    },
  }));

  app.use((req, res, next) => { req.db = db; next(); });

  // ─── Публічна точка для отримання CSRF-токену (потрібна адмін-фронту) ─
  app.get('/admin/csrf-token', (req, res) => {
    const token = generateCsrfToken(req, res);
    res.json({ csrfToken: token });
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
    console.log(`📋 Адмін-панель:   http://localhost:${PORT}/admin\n`);
  });

  // Авто-бекапи стартують після підняття сервера
  startBackupScheduler(db);
}

// Не запускаємо у тестовому режимі — там сервер створюється окремо
if (require.main === module) {
  start().catch(e => { console.error('Помилка запуску:', e); process.exit(1); });
}

module.exports = { start };
