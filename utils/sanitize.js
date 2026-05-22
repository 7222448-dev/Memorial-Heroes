// utils/sanitize.js — безпечне очищення HTML з Quill-редактора
//
// Адмінка довірена, але:
//  1) історію публікуємо у відкритий доступ через innerHTML
//  2) ми хочемо страхувати себе від випадкового <script>, <iframe>, onclick тощо
//  3) якщо в майбутньому з'явиться кілька авторів — захист уже на місці
//
// Тут навмисно ВУЗЬКИЙ whitelist — лише те, що видає Quill з нашого тулбару.
const sanitizeHtml = require('sanitize-html');

const STORY_OPTIONS = {
  allowedTags: [
    'p', 'br', 'hr',
    'strong', 'b', 'em', 'i', 'u', 's', 'strike',
    'h1', 'h2', 'h3',
    'ul', 'ol', 'li',
    'blockquote',
    'a',
    'span',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    // Quill пише inline-стилі (color, background-color, font-size, text-align) у style=""
    // та класи на span/p (ql-font-serif, ql-size-large, ql-align-center, ql-indent-1).
    // Дозволяємо обидва способи.
    span: ['style', 'class'],
    p: ['style', 'class'],
    h1: ['style', 'class'],
    h2: ['style', 'class'],
    h3: ['style', 'class'],
    li: ['style', 'class'],
    blockquote: ['style', 'class'],
  },
  allowedStyles: {
    '*': {
      // CSS колір: hex, rgb, rgba, кілька іменованих
      color: [/^#(0x)?[0-9a-f]+$/i, /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i, /^rgba?\(/i, /^[a-z]+$/i],
      'background-color': [/^#(0x)?[0-9a-f]+$/i, /^rgb\(/i, /^rgba?\(/i, /^[a-z]+$/i],
      'font-size': [/^\d+(?:\.\d+)?(px|em|rem|%)$/],
      'text-align': [/^(left|right|center|justify)$/],
    },
  },
  // Посилання — лише http/https/mailto; примусово додаємо noopener/noreferrer і target=_blank
  allowedSchemes: ['http', 'https', 'mailto'],
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer', target: '_blank' }),
  },
  // Прибираємо все, що не в whitelist (script, iframe, on* атрибути тощо)
  disallowedTagsMode: 'discard',
};

function sanitizeStoryHtml(html) {
  if (!html || typeof html !== 'string') return '';
  // Quill для порожньої історії генерує <p><br></p> — нормалізуємо в ''
  const trimmed = html.trim();
  if (trimmed === '' || trimmed === '<p><br></p>' || trimmed === '<p></p>') return '';
  return sanitizeHtml(trimmed, STORY_OPTIONS);
}

module.exports = { sanitizeStoryHtml };
