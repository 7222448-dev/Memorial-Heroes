const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { UPLOADS_DIR } = require('../db/paths');
const { sanitizeStoryHtml } = require('../utils/sanitize');

// Перетворити URL-шлях типу "/uploads/photos/abc.jpg" на реальний шлях на диску.
// У БД ми зберігаємо саме URL-шлях, бо він однаковий і для віддачі express.static,
// і для тегів <img src>. А для видалення треба знати фізичне розташування файлу.
function urlToFsPath(urlPath) {
  if (!urlPath) return null;
  // Прибираємо префікс /uploads/ і додаємо до UPLOADS_DIR
  const rel = urlPath.replace(/^\/?uploads\//, '');
  return path.join(UPLOADS_DIR, rel);
}

// Захист від brute-force: 10 спроб логіну на 15 хвилин з одного IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Забагато спроб входу. Спробуйте через 15 хвилин.' },
});

// Завантаження файлів
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    let folder = 'photos';
    if (file.mimetype.startsWith('audio/')) folder = 'audio';
    if (file.mimetype.startsWith('video/')) folder = 'video';
    const dest = path.join(UPLOADS_DIR, folder);
    fs.mkdirSync(dest, { recursive: true });
    cb(null, dest);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = file.mimetype.startsWith('image/') || file.mimetype.startsWith('audio/') || file.mimetype.startsWith('video/');
    cb(null, ok);
  }
});

function requireAuth(req, res, next) {
  if (req.session?.admin) return next();
  if (req.headers.accept?.includes('json')) return res.status(401).json({ error: 'Авторизуйтесь' });
  res.redirect('/admin/login');
}

// ═══ АВТОРИЗАЦІЯ ═══
router.get('/login', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'admin-login.html')));

router.post('/login', loginLimiter, (req, res) => {
  const { username, password } = req.body;
  const admin = req.db.get('SELECT * FROM admins WHERE username = ?', [username]);
  if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
    return res.status(401).json({ error: 'Невірний логін або пароль' });
  }
  req.session.admin = { id: admin.id, username: admin.username };
  res.json({ success: true });
});

router.post('/logout', (req, res) => { req.session.destroy(); res.json({ success: true }); });
router.get('/check', (req, res) => res.json({ authenticated: !!req.session?.admin }));

// ═══ АДМІН-ПАНЕЛЬ ═══
router.get('/', requireAuth, (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'admin.html')));

// Зміна паролю
router.post('/change-password', requireAuth, (req, res) => {
  const { current, newPassword } = req.body;
  const admin = req.db.get('SELECT * FROM admins WHERE id = ?', [req.session.admin.id]);
  if (!bcrypt.compareSync(current, admin.password_hash)) {
    return res.status(400).json({ error: 'Невірний поточний пароль' });
  }
  req.db.run('UPDATE admins SET password_hash = ? WHERE id = ?', [bcrypt.hashSync(newPassword, 10), admin.id]);
  res.json({ success: true });
});

// ═══ CRUD ГЕРОЇВ ═══
router.get('/heroes', requireAuth, (req, res) => {
  try {
    const heroes = req.db.all('SELECT * FROM heroes ORDER BY updated_at DESC');
    res.json({ heroes });
  } catch (err) { res.status(500).json({ error: 'Помилка' }); }
});

router.get('/heroes/:id', requireAuth, (req, res) => {
  try {
    const hero = req.db.get('SELECT * FROM heroes WHERE id = ?', [parseInt(req.params.id)]);
    if (!hero) return res.status(404).json({ error: 'Не знайдено' });
    hero.awards = req.db.all('SELECT * FROM awards WHERE hero_id = ?', [hero.id]);
    hero.gallery = req.db.all('SELECT * FROM gallery WHERE hero_id = ? ORDER BY sort_order', [hero.id]);
    hero.media = req.db.all('SELECT * FROM media WHERE hero_id = ? ORDER BY sort_order', [hero.id]);
    res.json(hero);
  } catch (err) { res.status(500).json({ error: 'Помилка' }); }
});

router.post('/heroes', requireAuth, upload.single('photo'), (req, res) => {
  try {
    const { name, callsign, rank, born, fallen, unit, brigade, battalion, company, city, story, awards } = req.body;
    const photo = req.file ? `/uploads/photos/${req.file.filename}` : null;
    const safeStory = sanitizeStoryHtml(story);
    const result = req.db.run(
      'INSERT INTO heroes (name, callsign, rank, born, fallen, unit, brigade, battalion, company, city, story, photo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [name, callsign || null, rank || null, born || null, fallen || null, unit || null, brigade || null, battalion || null, company || null, city || null, safeStory || null, photo]
    );
    const heroId = result.lastInsertRowid;
    if (awards) {
      JSON.parse(awards).forEach(a => req.db.run('INSERT INTO awards (hero_id, title) VALUES (?, ?)', [heroId, a]));
    }
    res.json({ id: heroId, success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Помилка створення' }); }
});

router.put('/heroes/:id', requireAuth, upload.single('photo'), (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { name, callsign, rank, born, fallen, unit, brigade, battalion, company, city, story, awards } = req.body;
    const hero = req.db.get('SELECT * FROM heroes WHERE id = ?', [id]);
    if (!hero) return res.status(404).json({ error: 'Не знайдено' });
    const photo = req.file ? `/uploads/photos/${req.file.filename}` : hero.photo;
    const safeStory = sanitizeStoryHtml(story);
    req.db.run(
      'UPDATE heroes SET name=?, callsign=?, rank=?, born=?, fallen=?, unit=?, brigade=?, battalion=?, company=?, city=?, story=?, photo=?, updated_at=CURRENT_TIMESTAMP WHERE id=?',
      [name, callsign || null, rank || null, born || null, fallen || null, unit || null, brigade || null, battalion || null, company || null, city || null, safeStory || null, photo, id]
    );
    if (awards) {
      req.db.run('DELETE FROM awards WHERE hero_id = ?', [id]);
      JSON.parse(awards).forEach(a => req.db.run('INSERT INTO awards (hero_id, title) VALUES (?, ?)', [id, a]));
    }
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Помилка оновлення' }); }
});

router.delete('/heroes/:id', requireAuth, (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const gallery = req.db.all('SELECT filename FROM gallery WHERE hero_id = ?', [id]);
    const media = req.db.all('SELECT filename FROM media WHERE hero_id = ?', [id]);
    const hero = req.db.get('SELECT photo FROM heroes WHERE id = ?', [id]);
    [...gallery, ...media].forEach(f => {
      const p = urlToFsPath(f.filename);
      if (p && fs.existsSync(p)) fs.unlinkSync(p);
    });
    if (hero?.photo) {
      const p = urlToFsPath(hero.photo);
      if (p && fs.existsSync(p)) fs.unlinkSync(p);
    }
    req.db.run('DELETE FROM awards WHERE hero_id = ?', [id]);
    req.db.run('DELETE FROM gallery WHERE hero_id = ?', [id]);
    req.db.run('DELETE FROM media WHERE hero_id = ?', [id]);
    req.db.run('DELETE FROM heroes WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Помилка видалення' }); }
});

// ═══ ГАЛЕРЕЯ ═══
router.post('/heroes/:id/gallery', requireAuth, upload.array('photos', 20), (req, res) => {
  try {
    const id = parseInt(req.params.id);
    req.files.forEach((f, i) => {
      req.db.run('INSERT INTO gallery (hero_id, filename, caption, sort_order) VALUES (?, ?, ?, ?)', [id, `/uploads/photos/${f.filename}`, '', i]);
    });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Помилка' }); }
});

router.delete('/gallery/:id', requireAuth, (req, res) => {
  try {
    const photo = req.db.get('SELECT filename FROM gallery WHERE id = ?', [parseInt(req.params.id)]);
    if (photo) {
      const p = urlToFsPath(photo.filename);
      if (p && fs.existsSync(p)) fs.unlinkSync(p);
      req.db.run('DELETE FROM gallery WHERE id = ?', [parseInt(req.params.id)]);
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Помилка' }); }
});

// Збереження нового порядку фото героя.
// body: { order: [id1, id2, id3, ...] } — id у тому порядку, в якому вони мають відображатись.
// Оновлюємо sort_order = індекс у масиві. Все в одній транзакції для атомарності.
router.put('/heroes/:id/gallery/reorder', requireAuth, (req, res) => {
  try {
    const heroId = parseInt(req.params.id);
    const order = Array.isArray(req.body?.order) ? req.body.order : [];
    if (!order.length) return res.json({ success: true, updated: 0 });

    const txn = req.db._raw.transaction((ids) => {
      const upd = req.db._raw.prepare('UPDATE gallery SET sort_order = ? WHERE id = ? AND hero_id = ?');
      ids.forEach((photoId, idx) => upd.run(idx, parseInt(photoId), heroId));
    });
    txn(order);

    res.json({ success: true, updated: order.length });
  } catch (err) {
    console.error('gallery reorder:', err);
    res.status(500).json({ error: 'Не вдалось зберегти порядок' });
  }
});

// ═══ МЕДІА ═══
router.post('/heroes/:id/media', requireAuth, upload.single('file'), (req, res) => {
  try {
    const { title, type, duration } = req.body;
    const folder = type === 'audio' ? 'audio' : 'video';
    const filename = `/uploads/${folder}/${req.file.filename}`;
    const result = req.db.run('INSERT INTO media (hero_id, type, filename, title, duration) VALUES (?, ?, ?, ?, ?)',
      [parseInt(req.params.id), type, filename, title || '', duration || '']);
    res.json({ id: result.lastInsertRowid, success: true });
  } catch (err) { res.status(500).json({ error: 'Помилка' }); }
});

router.delete('/media/:id', requireAuth, (req, res) => {
  try {
    const media = req.db.get('SELECT filename FROM media WHERE id = ?', [parseInt(req.params.id)]);
    if (media) {
      const p = urlToFsPath(media.filename);
      if (p && fs.existsSync(p)) fs.unlinkSync(p);
      req.db.run('DELETE FROM media WHERE id = ?', [parseInt(req.params.id)]);
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Помилка' }); }
});

// ═══ ІМПОРТ ДАНИХ (CSV / JSON) ═══
const csvUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

router.post('/import', requireAuth, csvUpload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Файл не завантажено' });

    const content = req.file.buffer.toString('utf-8');
    const ext = path.extname(req.file.originalname).toLowerCase();
    let records = [];

    if (ext === '.json') {
      // JSON імпорт
      const parsed = JSON.parse(content);
      records = Array.isArray(parsed) ? parsed : (parsed.heroes || parsed.data || [parsed]);
    } else if (ext === '.csv' || ext === '.tsv') {
      // CSV/TSV імпорт
      const sep = ext === '.tsv' ? '\t' : detectSeparator(content);
      const lines = content.split(/\r?\n/).filter(l => l.trim());
      if (lines.length < 2) return res.status(400).json({ error: 'Файл порожній або має тільки заголовки' });

      const headers = parseCSVLine(lines[0], sep).map(h => h.trim().toLowerCase());
      
      for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i], sep);
        if (values.length < 2) continue; // пропускаємо пусті рядки
        const obj = {};
        headers.forEach((h, idx) => { obj[mapHeader(h)] = values[idx]?.trim() || ''; });
        records.push(obj);
      }
    } else {
      return res.status(400).json({ error: 'Підтримуються формати: .csv, .tsv, .json' });
    }

    if (records.length === 0) return res.status(400).json({ error: 'Не знайдено записів у файлі' });

    // Перевірка — повернути preview якщо mode=preview
    if (req.body.mode === 'preview') {
      return res.json({ 
        records: records.slice(0, 10),
        total: records.length,
        fields: Object.keys(records[0] || {})
      });
    }

    // Імпорт у базу
    let imported = 0;
    let skipped = 0;
    let errors = [];

    records.forEach((r, idx) => {
      try {
        if (!r.name) { skipped++; return; }

        // Перевірка на дублікат (ім'я + дата загибелі)
        const existing = req.db.get('SELECT id FROM heroes WHERE name = ? AND fallen = ?', [r.name, r.fallen || '']);
        if (existing && req.body.skip_duplicates !== 'false') { skipped++; return; }

        const result = req.db.run(
          `INSERT INTO heroes (name, callsign, rank, born, fallen, unit, brigade, battalion, company, city, story, candles)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            r.name, r.callsign || null, r.rank || null, r.born || null,
            r.fallen || null, r.unit || null, r.brigade || null,
            r.battalion || null, r.company || null, r.city || null,
            sanitizeStoryHtml(r.story) || null, parseInt(r.candles) || 0
          ]
        );

        // Нагороди (через кому або через ;)
        if (r.awards) {
          const heroId = result.lastInsertRowid;
          const awardsList = r.awards.split(/[;,]/).map(a => a.trim()).filter(Boolean);
          awardsList.forEach(a => {
            req.db.run('INSERT INTO awards (hero_id, title) VALUES (?, ?)', [heroId, a]);
          });
        }

        imported++;
      } catch(e) {
        errors.push(`Рядок ${idx + 2}: ${e.message}`);
      }
    });

    res.json({ 
      success: true, 
      imported, 
      skipped, 
      total: records.length,
      errors: errors.slice(0, 10) // перші 10 помилок
    });
  } catch (err) {
    console.error('Import error:', err);
    res.status(500).json({ error: `Помилка імпорту: ${err.message}` });
  }
});

// Експорт даних
router.get('/export', requireAuth, (req, res) => {
  try {
    const format = req.query.format || 'json';
    const heroes = req.db.all('SELECT * FROM heroes ORDER BY name ASC');
    
    heroes.forEach(h => {
      h.awards = req.db.all('SELECT title FROM awards WHERE hero_id = ?', [h.id]).map(a => a.title).join('; ');
    });

    if (format === 'csv') {
      const headers = 'name,callsign,rank,born,fallen,unit,brigade,battalion,company,city,awards,story,candles';
      const rows = heroes.map(h => 
        [h.name, h.callsign, h.rank, h.born, h.fallen, h.unit, h.brigade, h.battalion, h.company, h.city, h.awards, (h.story || '').replace(/"/g, '""').replace(/<[^>]*>/g, ''), h.candles]
        .map(v => `"${(v || '').toString().replace(/"/g, '""')}"`)
        .join(',')
      );
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename=heroes-export-${Date.now()}.csv`);
      res.send('\uFEFF' + headers + '\n' + rows.join('\n')); // BOM for Excel
    } else {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename=heroes-export-${Date.now()}.json`);
      res.json({ heroes });
    }
  } catch (err) { res.status(500).json({ error: 'Помилка експорту' }); }
});

// Шаблон для імпорту
router.get('/import-template', requireAuth, (req, res) => {
  const csv = '\uFEFFname,callsign,rank,born,fallen,unit,brigade,battalion,company,city,awards,story\n' +
    '"Прізвище Ім\'я По-батькові","Позивний","Солдат","01.01.1990","01.01.2023","1 ОШБр","1-ша окрема штурмова бригада","2-й штурмовий батальйон","1-ша рота","Київ","Орден За мужність III ст.;Медаль Захиснику Вітчизни","<p>Текст історії</p>"';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename=import-template.csv');
  res.send(csv);
});

// ═══ ДОПОМІЖНІ ФУНКЦІЇ ═══
function detectSeparator(content) {
  const firstLine = content.split(/\r?\n/)[0];
  const commas = (firstLine.match(/,/g) || []).length;
  const semicolons = (firstLine.match(/;/g) || []).length;
  const tabs = (firstLine.match(/\t/g) || []).length;
  if (tabs > commas && tabs > semicolons) return '\t';
  if (semicolons > commas) return ';';
  return ',';
}

function parseCSVLine(line, sep = ',') {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === sep && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function mapHeader(h) {
  const map = {
    "ім'я": 'name', 'имя': 'name', 'прізвище': 'name', 'пib': 'name', 'піб': 'name',
    'full_name': 'name', 'fullname': 'name', 'name': 'name',
    'позивний': 'callsign', 'callsign': 'callsign', 'позивной': 'callsign',
    'звання': 'rank', 'rank': 'rank', 'звание': 'rank',
    'народження': 'born', 'born': 'born', 'дата_народження': 'born', 'birthday': 'born', 'birth': 'born',
    'загибель': 'fallen', 'fallen': 'fallen', 'дата_загибелі': 'fallen', 'death': 'fallen', 'died': 'fallen',
    'підрозділ': 'unit', 'unit': 'unit', 'подразделение': 'unit',
    'бригада': 'brigade', 'brigade': 'brigade',
    'батальйон': 'battalion', 'battalion': 'battalion', 'батальон': 'battalion',
    'рота': 'company', 'company': 'company',
    'місто': 'city', 'city': 'city', 'город': 'city',
    'нагороди': 'awards', 'awards': 'awards', 'награды': 'awards',
    'історія': 'story', 'story': 'story', 'bio': 'story', 'біографія': 'story',
    'свічки': 'candles', 'candles': 'candles'
  };
  return map[h.toLowerCase().trim()] || h.toLowerCase().replace(/\s+/g, '_');
}

module.exports = router;
