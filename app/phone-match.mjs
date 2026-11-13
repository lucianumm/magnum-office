// Comparing phone numbers the way WhatsApp writes them. Brazilian mobile numbers exist with and without the
// ninth digit ("5564999990000" and "556499990000" are the same line), with and without +55 and with
// punctuation. A key that ignores those differences lets a number typed by the office match the one in
// a WhatsApp address. Foreign numbers are compared as typed (digits only).
export function phoneDigits(value) {
  return String(value ?? '').replace(/\D/g, '');
}

// Area codes in use in Brazil. A number is only treated as Brazilian when its area code is one of these, so a
// foreign number with the same length (+1 202 555 0100, 11 digits) is never given a "55".
const DDD = new Set(
  '11 12 13 14 15 16 17 18 19 21 22 24 27 28 31 32 33 34 35 37 38 41 42 43 44 45 46 47 48 49 51 53 54 55 61 62 63 64 65 66 67 68 69 71 73 74 75 77 79 81 82 83 84 85 86 87 88 89 91 92 93 94 95 96 97 98 99'.split(
    ' ',
  ),
);
// 55 + DDD + (9 + eight digits | eight digits) → the ninth digit is dropped, so both spellings give one key.
function brazilianKey(d) {
  const ddd = d.slice(2, 4);
  const rest = d.slice(4);
  return '55' + ddd + (rest.length === 9 && rest[0] === '9' ? rest.slice(1) : rest);
}

export function phoneKey(value) {
  const d = phoneDigits(value);
  if (!d) return '';
  const plus = String(value).trim().startsWith('+');
  if (d.startsWith('55') && [12, 13].includes(d.length) && DDD.has(d.slice(2, 4))) return brazilianKey(d);
  // Typed without country code: DDD + 8 digits, or DDD + 9 + eight digits (a mobile number has the nine).
  if (!plus && DDD.has(d.slice(0, 2)) && (d.length === 10 || (d.length === 11 && d[2] === '9')))
    return brazilianKey('55' + d);
  return d;
}

export const samePhone = (a, b) => {
  const x = phoneKey(a);
  return x !== '' && x === phoneKey(b);
};

// The number inside a WhatsApp address, or '' for groups, broadcasts, channels and addresses that carry
// no number (LID). Pass the "alt" address when WhatsApp gives one: it holds the number of a LID chat.
export function numberFromJid(jid, altJid = '') {
  for (const candidate of [jid, altJid]) {
    const m = /^(\d{8,15})(?::\d+)?@s\.whatsapp\.net$/.exec(String(candidate || ''));
    if (m) return m[1];
  }
  return '';
}

// Only one-to-one chats are of interest: not groups (@g.us), status, broadcast lists or channels.
export const isIndividualJid = jid => /@(s\.whatsapp\.net|lid)$/.test(String(jid || ''));
