function whatsappNumber(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Informe o WhatsApp do cliente com DDD.');
  if (!/^\+?[\d\s().-]+$/.test(value.trim()))
    throw new Error('WhatsApp inválido. Use DDD e número, ou + e código do país.');
  const digits = value.replace(/\D/g, '');
  const phone = !value.trim().startsWith('+') && [10, 11].includes(digits.length) ? '55' + digits : digits;
  if (!/^[1-9]\d{9,14}$/.test(phone))
    throw new Error('WhatsApp inválido. Informe DDD e número; para outros países, use + e código do país.');
  return phone;
}
module.exports = { whatsappNumber };
