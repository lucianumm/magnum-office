// Sending rules for WhatsApp: a daily window, a cap per hour and per day, and a random pause between
// messages. WhatsApp's unofficial client can get a number banned when it sends in bursts or at odd
// hours, so every automatic message passes through these rules. Pure functions: the caller gives the
// clock and the counters, so everything is testable without waiting.
export const defaultLimits = {
  sendWindowStart: 8, // hour the window opens (local time)
  sendWindowEnd: 19, // hour the window closes (the message at 18:59 still goes)
  sendOnSaturday: true,
  sendOnSunday: false,
  hourlyLimit: 30,
  dailyLimit: 200,
  minDelaySec: 8,
  maxDelaySec: 25,
};

const limitsOf = config => ({
  ...defaultLimits,
  ...Object.fromEntries(Object.entries(config || {}).filter(([k]) => k in defaultLimits)),
});
const dayAllowed = (date, c) => (date.getDay() === 0 ? c.sendOnSunday : date.getDay() === 6 ? c.sendOnSaturday : true);

// Is this instant inside the sending window?
export function windowOpen(now, config) {
  const c = limitsOf(config);
  const d = new Date(now);
  const hour = d.getHours() + d.getMinutes() / 60;
  return dayAllowed(d, c) && hour >= c.sendWindowStart && hour < c.sendWindowEnd;
}

// The next instant the window is open (now, if it already is). Looks at most 8 days ahead.
export function nextWindow(now, config) {
  const c = limitsOf(config);
  if (windowOpen(now, c)) return new Date(now).getTime();
  const d = new Date(now);
  for (let i = 0; i < 9; i++) {
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() + i, c.sendWindowStart, 0, 0, 0);
    if (start.getTime() > now && dayAllowed(start, c)) return start.getTime();
  }
  return null;
}

// Minutes of open window between two instants. A scheduled message only "waits too long" while the window
// is open: a message for 20:00 that goes out at 08:05 the next morning waited 5 minutes, not 12 hours.
export function openMinutes(from, to, config) {
  const c = limitsOf(config);
  if (to <= from) return 0;
  let total = 0;
  const day = new Date(from);
  day.setHours(0, 0, 0, 0);
  for (let i = 0; i < 40 && day.getTime() < to; i++) {
    const d = new Date(day.getFullYear(), day.getMonth(), day.getDate() + i);
    if (!dayAllowed(d, c)) continue;
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), c.sendWindowStart).getTime();
    const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), c.sendWindowEnd).getTime();
    const overlap = Math.min(end, to) - Math.max(start, from);
    if (overlap > 0) total += overlap / 60000;
    if (start > to) break;
  }
  return Math.round(total);
}

// { allowed, reason, retryAt } for one more message now. counters: { lastHour, today, nextAt }.
export function decide(now, config, counters = {}) {
  const c = limitsOf(config);
  if (!windowOpen(now, c)) return { allowed: false, reason: 'window', retryAt: nextWindow(now, c) };
  if ((counters.today || 0) >= c.dailyLimit)
    return { allowed: false, reason: 'daily', retryAt: nextWindow(endOfDay(now), c) };
  if ((counters.lastHour || 0) >= c.hourlyLimit) return { allowed: false, reason: 'hourly', retryAt: now + 60000 };
  if (counters.nextAt && now < counters.nextAt) return { allowed: false, reason: 'delay', retryAt: counters.nextAt };
  return { allowed: true, reason: '', retryAt: now };
}
const endOfDay = now => {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0).getTime();
};

// Pause before the next message, between the configured minimum and maximum (random is injectable).
export function nextDelayMs(config, random = Math.random) {
  const c = limitsOf(config);
  const min = Math.min(c.minDelaySec, c.maxDelaySec);
  const max = Math.max(c.minDelaySec, c.maxDelaySec);
  return Math.round((min + random() * (max - min)) * 1000);
}

// Time the messages *ahead* of the last one need to go out at the hourly cap (one message alone needs none).
// Used so a long queue draining at the cap is not mistaken for forgotten messages.
export const drainMinutes = (pending, config) =>
  Math.ceil(Math.max(0, pending - 1) / limitsOf(config).hourlyLimit) * 60;

export function validateLimits(input) {
  const c = limitsOf(input);
  const int = (value, min, max, label) => {
    if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${label}: de ${min} a ${max}.`);
    return value;
  };
  const out = {
    sendWindowStart: int(c.sendWindowStart, 0, 23, 'Início da janela'),
    sendWindowEnd: int(c.sendWindowEnd, 1, 24, 'Fim da janela'),
    sendOnSaturday: c.sendOnSaturday === true,
    sendOnSunday: c.sendOnSunday === true,
    hourlyLimit: int(c.hourlyLimit, 1, 120, 'Limite por hora'),
    dailyLimit: int(c.dailyLimit, 1, 1000, 'Limite por dia'),
    minDelaySec: int(c.minDelaySec, 3, 120, 'Pausa mínima'),
    maxDelaySec: int(c.maxDelaySec, 3, 300, 'Pausa máxima'),
  };
  if (out.sendWindowEnd <= out.sendWindowStart) throw new Error('O fim da janela deve ser depois do início.');
  if (out.maxDelaySec < out.minDelaySec) throw new Error('A pausa máxima não pode ser menor que a mínima.');
  if (out.dailyLimit < out.hourlyLimit) throw new Error('O limite por dia não pode ser menor que o limite por hora.');
  return out;
}
