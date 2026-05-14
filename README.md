# 🕯️ Книга Пам'яті — Сайт пам'яті загиблим героям

## Швидкий старт (локально)

```bash
# 1. Встановіть Node.js (якщо ще нема): https://nodejs.org
#    Завантажте LTS версію (20+)

# 2. Розпакуйте архів та перейдіть у папку проєкту
cd memorial-backend

# 3. Встановіть залежності
npm install

# 4. Запустіть сервер
npm start

# 5. Відкрийте у браузері
#    Сайт:         http://localhost:3000
#    Адмін-панель:  http://localhost:3000/admin
#    Логін: admin / admin123 (ЗМІНІТЬ ПАРОЛЬ!)
```

## Структура проєкту

```
memorial-backend/
├── server.js              # Головний сервер Express
├── package.json           # Залежності
├── db/
│   ├── init.js            # Ініціалізація бази даних
│   └── memorial.db        # SQLite база (створюється автоматично)
├── routes/
│   ├── api.js             # API для публічного сайту
│   └── admin.js           # Маршрути адмін-панелі
└── public/
    ├── index.html          # Головна сторінка сайту
    ├── admin.html          # Адмін-панель
    ├── admin-login.html    # Сторінка входу
    └── uploads/            # Завантажені файли
        ├── photos/
        ├── audio/
        └── video/
```

## Розгортання на сервері

### Варіант А: Railway.app (рекомендую, є безкоштовний $5/міс кредит)

**Крок 1. Підготуйте репозиторій GitHub.**

У PowerShell у папці проекту:

```powershell
git init
git add .
git commit -m "Initial commit: Memorial heroes site"
git branch -M main
```

Створіть новий репозиторій на github.com (кнопка `New repository`, назва наприклад `memorial-heroes-ua`, без README — він уже є). Скопіюйте URL і:

```powershell
git remote add origin https://github.com/ВАШ_ЮЗЕРНЕЙМ/memorial-heroes-ua.git
git push -u origin main
```

**Крок 2. Згенеруйте секрети для production.**

У PowerShell:

```powershell
node -e "console.log('SESSION_SECRET=' + require('crypto').randomBytes(48).toString('base64'))"
node -e "console.log('CSRF_SECRET=' + require('crypto').randomBytes(48).toString('base64'))"
```

Скопіюйте обидва рядки — додасте у Railway на наступному кроці.

**Крок 3. Деплой на Railway.**

1. Зареєструйтесь на [railway.app](https://railway.app) (можна через GitHub)
2. `New Project` → `Deploy from GitHub repo` → виберіть `memorial-heroes-ua`
3. Railway сам прочитає `railway.toml`, запустить `npm install` і `npm start`
4. Перейдіть у `Variables` і додайте:
   - `NODE_ENV` = `production`
   - `SESSION_SECRET` = (рядок з кроку 2)
   - `CSRF_SECRET` = (рядок з кроку 2)
5. Перейдіть у `Settings` → `Networking` → `Generate Domain` — отримаєте URL виду `your-app.up.railway.app`
6. Через 1-2 хвилини сайт буде живий

**⚠️ Важливо без Volume:** без під'єднаного диску **дані БД та завантажені файли зникають при кожному redeploy**. Це нормально для тестування. Коли захочете перейти у бойовий режим — додайте Volume через `+ Create` → `Volume` → змонтуйте у `/app/db` та `/app/public/uploads`.

### Варіант Б: Render.com (безкоштовно)

1. Зареєструйтесь на [render.com](https://render.com)
2. New → Web Service → підключіть GitHub
3. Build Command: `npm install`
4. Start Command: `npm start`
5. Безкоштовний план достатній для старту

### Варіант В: VPS (DigitalOcean, Hetzner)

```bash
# На сервері Ubuntu 22+:

# 1. Встановіть Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 2. Завантажте проєкт
git clone <ваш-репозиторій> /var/www/memorial
cd /var/www/memorial

# 3. Встановіть залежності
npm install --production

# 4. Налаштуйте змінні середовища
export PORT=3000
export SESSION_SECRET="ваш-секретний-ключ-тут"

# 5. Встановіть PM2 для автозапуску
sudo npm install -g pm2
pm2 start server.js --name memorial
pm2 startup
pm2 save

# 6. Налаштуйте Nginx як реверс-проксі
sudo apt install nginx
```

Конфігурація Nginx (`/etc/nginx/sites-available/memorial`):
```nginx
server {
    listen 80;
    server_name your-domain.ua;

    client_max_body_size 100M;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
# Активуйте конфіг
sudo ln -s /etc/nginx/sites-available/memorial /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx

# Встановіть SSL сертифікат (безкоштовно)
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.ua
```

## API Документація

| Метод | URL | Опис |
|-------|-----|------|
| GET | `/api/heroes` | Список героїв (?page=1&limit=50&brigade=X&battalion=Y&company=Z) |
| GET | `/api/heroes/search?q=...` | Пошук за прізвищем/позивним |
| GET | `/api/heroes/:id` | Повний профіль героя |
| POST | `/api/heroes/:id/candle` | Запалити свічку |
| GET | `/api/stats` | Статистика сайту |
| GET | `/api/units` | Список підрозділів для фільтрів (?brigade=X — каскадна фільтрація) |

## Адмін API (потребує авторизації)

| Метод | URL | Опис |
|-------|-----|------|
| POST | `/admin/login` | Авторизація |
| POST | `/admin/heroes` | Створити запис |
| PUT | `/admin/heroes/:id` | Оновити запис |
| DELETE | `/admin/heroes/:id` | Видалити запис |
| POST | `/admin/heroes/:id/gallery` | Завантажити фото |
| POST | `/admin/heroes/:id/media` | Завантажити аудіо/відео |
| POST | `/admin/import` | Імпорт даних (CSV/TSV/JSON) |
| GET | `/admin/export?format=csv` | Експорт у CSV |
| GET | `/admin/export?format=json` | Експорт у JSON |
| GET | `/admin/import-template` | Завантажити шаблон CSV для імпорту |

## Імпорт даних

Підтримувані формати: CSV, TSV, JSON. Заголовки колонок розпізнаються автоматично:
- Українські: ім'я, позивний, звання, бригада, батальйон, рота, місто, нагороди, історія
- Англійські: name, callsign, rank, brigade, battalion, company, city, awards, story
- Нагороди через крапку з комою: "Орден мужності; Медаль захиснику"
- Дублікати автоматично пропускаються (за ім'ям + датою загибелі)

## Фільтрація по підрозділах

Каскадна система фільтрів: Бригада → Батальйон → Рота.
При виборі бригади — автоматично фільтруються доступні батальйони та роти.
Фільтри доступні як на головному сайті, так і в адмін-панелі.

## Безпека

- ⚠️ **Обов'язково змініть пароль** адміна після першого входу
- Встановіть змінну `SESSION_SECRET` з унікальним значенням (>= 32 символи)
- Опціонально — окрема змінна `CSRF_SECRET` для CSRF-токенів
- На продакшені використовуйте HTTPS (Certbot/Let's Encrypt)
- Регулярно перевіряйте папку `db/backups/`

### Реалізовані механізми захисту

- **CSRF-захист** для всіх POST/PUT/DELETE на `/admin/*` (`csrf-csrf`, double-submit cookie)
- **Rate-limiting** на `/api/heroes/:id/candle` (5 запалень/хв з IP), на `/api/heroes/search` (60/хв), на `/admin/login` (10 спроб/15 хв — захист від brute-force)
- **Захищені cookie сесії** (`httpOnly`, `sameSite=lax`, `secure` у production)
- **bcrypt** для зберігання паролів адмінів

## Бекап бази даних

Сервер автоматично робить **щоденні бекапи** в папку `db/backups/`, тримаючи останні 14 копій (значення можна змінити через `BACKUP_KEEP=N`). Перший бекап створюється через хвилину після старту сервера, далі — раз на 24 години.

Зробити бекап вручну:

```bash
npm run backup
```

Або старим способом:

```bash
cp db/memorial.db db/memorial-backup-$(date +%Y%m%d).db
```

Для додаткової страховки можна підняти cron на сервері:

```bash
0 3 * * * cp /var/www/memorial/db/memorial.db /var/backups/memorial-$(date +\%Y\%m\%d).db
```

## Тести та лінт

```bash
npm test            # запустити jest-тести
npm run lint        # перевірити код ESLint
npm run lint:fix    # автоматично виправити, що можливо
npm run format      # відформатувати Prettier
```

## Ліцензія

Цей проєкт створено з повагою до пам'яті захисників та захисниць України.
Вільне використання для некомерційних цілей.

🇺🇦 Героям слава!
