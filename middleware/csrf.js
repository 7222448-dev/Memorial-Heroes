// middleware/csrf.js — CSRF-захист на базі csrf-csrf (double-submit cookie pattern)
//
// Чому csrf-csrf, а не csurf:
//   csurf офіційно deprecated. csrf-csrf — сучасна підтримувана альтернатива.
//
// Як це працює:
//  • При першому GET-запиті до /admin/csrf-token бекенд видає токен у відповіді
//    і одночасно ставить hash-cookie на стороні клієнта
//  • Фронтенд (admin.html) додає токен у заголовок x-csrf-token на кожний POST/PUT/DELETE
//  • Middleware зіставляє токен у заголовку з hash-cookie. Збіг = свій запит
const { doubleCsrf } = require('csrf-csrf');

const secret = process.env.CSRF_SECRET
  || process.env.SESSION_SECRET
  || 'memorial-csrf-fallback-change-me';

const {
  generateCsrfToken,
  doubleCsrfProtection,
  invalidCsrfTokenError,
} = doubleCsrf({
  getSecret: () => secret,
  getSessionIdentifier: (req) => req.sessionID || req.ip || 'anon',
  cookieName: process.env.NODE_ENV === 'production' ? '__Host-csrf' : 'memorial.csrf',
  cookieOptions: {
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    path: '/',
  },
  getCsrfTokenFromRequest: (req) =>
    req.headers['x-csrf-token']
    || req.body?._csrf
    || req.query?._csrf,
});

module.exports = {
  generateCsrfToken,
  doubleCsrfProtection,
  invalidCsrfTokenError,
};
