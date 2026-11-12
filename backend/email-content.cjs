const sanitize = require('sanitize-html');
function cleanHTML(value = '') {
  if (typeof value !== 'string' || value.length > 90000) throw new Error('Conteúdo do e-mail muito extenso.');
  return sanitize(value, {
    allowedTags: [
      'p',
      'div',
      'br',
      'strong',
      'b',
      'em',
      'i',
      'u',
      's',
      'ul',
      'ol',
      'li',
      'blockquote',
      'a',
      'span',
      'h1',
      'h2',
      'h3',
      'hr',
      'font',
    ],
    allowedAttributes: {
      a: ['href', 'title'],
      span: ['style'],
      p: ['style'],
      div: ['style'],
      font: ['color', 'size', 'face'],
    },
    allowedSchemes: ['https', 'http', 'mailto'],
    allowedStyles: {
      '*': {
        color: [/^#[0-9a-f]{3,8}$/i, /^rgb\([\d, ]+\)$/],
        'background-color': [/^#[0-9a-f]{3,8}$/i],
        'text-align': [/^(left|right|center|justify)$/],
        'font-weight': [/^(bold|[1-9]00)$/],
        'font-size': [/^\d{1,2}(px|pt)$/],
        'text-decoration': [/^(underline|line-through)$/],
      },
    },
  });
}
module.exports = { cleanHTML };
