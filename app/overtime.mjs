// Overtime with its usual effects (reflexos) for a labour claim, in whole cents. An estimate based
// on monthly averages: the office states the average extra hours per month and the period.
import { parseMoney } from './money.mjs';

const cents = value => {
  const parsed = parseMoney(value);
  return parsed ? Math.round(Number(parsed) * 100) : parsed === '' ? 0 : null;
};
const share = (amount, numerator, denominator) => Math.round((amount * numerator) / denominator);

export function calculateOvertime(input) {
  const salary = cents(input.salary);
  if (!salary) throw new Error('Informe o salário mensal.');
  const divisor = Number(input.divisor) || 220;
  if (![150, 180, 200, 220].includes(divisor)) throw new Error('Divisor de horas: 150, 180, 200 ou 220.');
  const hours = Number(String(input.hours ?? '').replace(',', '.'));
  if (!Number.isFinite(hours) || hours <= 0 || hours > 200) throw new Error('Informe a média de horas extras por mês.');
  const percent = Number(String(input.percent ?? '50').replace(',', '.'));
  if (!Number.isFinite(percent) || percent < 50 || percent > 200) throw new Error('Adicional de 50% a 200%.');
  const months = Number.parseInt(input.months, 10);
  if (!Number.isInteger(months) || months < 1 || months > 60) throw new Error('Informe de 1 a 60 meses.');
  const noticeDays = Math.max(0, Math.min(90, Number.parseInt(input.noticeDays, 10) || 0));
  const finePercent = [0, 20, 40].includes(Number(input.finePercent)) ? Number(input.finePercent) : 40;

  // Hourly rate × (1 + percentage) × hours (art. 59, § 1º, CLT; Súmula 264 do TST).
  const monthly = Math.round((salary / divisor) * (1 + percent / 100) * hours);
  // Weekly rest (DSR): approximated as 1/6 of the overtime (6 working days to 1 rest day).
  const dsr = Math.round(monthly / 6);
  // OJ 394 da SDI-1 (2023): the increased DSR reflects in the other items for overtime from 20/03/2023.
  const dsrInBase = input.dsrInBase !== false;
  const base = monthly + (dsrInBase ? dsr : 0);
  const items = [
    {
      key: 'he',
      label: `Horas extras (${hours} h/mês a ${percent}%)`,
      reference: `${months} mês(es)`,
      value: monthly * months,
    },
    {
      key: 'dsr',
      label: 'Reflexo no descanso semanal remunerado (1/6)',
      reference: `${months} mês(es)`,
      value: dsr * months,
    },
    { key: '13', label: 'Reflexo no 13º salário', reference: `${months}/12`, value: share(base, months, 12) },
    {
      key: 'ferias',
      label: 'Reflexo nas férias com 1/3',
      reference: `${months}/12`,
      value: Math.round((share(base, months, 12) * 4) / 3),
    },
  ];
  if (noticeDays)
    items.push({
      key: 'aviso',
      label: 'Reflexo no aviso prévio indenizado',
      reference: `${noticeDays} dia(s)`,
      value: share(base, noticeDays, 30),
    });
  const fgtsBase = items.filter(i => i.key !== 'ferias').reduce((n, i) => n + i.value, 0);
  const fgts = Math.round(fgtsBase * 0.08);
  items.push({ key: 'fgts', label: 'FGTS (8%) sobre horas extras e reflexos', reference: '', value: fgts });
  if (finePercent)
    items.push({
      key: 'multa',
      label: `Multa de ${finePercent}% sobre esse FGTS`,
      reference: '',
      value: Math.round((fgts * finePercent) / 100),
    });
  const total = items.reduce((n, i) => n + i.value, 0);
  return {
    items,
    total,
    hourly: Math.round(salary / divisor),
    monthly,
    basis: [
      `Valor da hora: salário ÷ ${divisor}; hora extra com adicional de ${percent}% (art. 7º, XVI, da CF; Súmula 264 do TST).`,
      'Reflexos no DSR (Súmula 172 do TST), no 13º, nas férias com 1/3, no aviso prévio e no FGTS (Súmula 63 do TST).',
      dsrInBase
        ? 'O DSR acrescido das horas extras reflete nas demais parcelas (OJ 394 da SDI-1, redação de 2023), aplicável às horas prestadas a partir de 20/03/2023.'
        : 'O DSR acrescido das horas extras não reflete nas demais parcelas (OJ 394 da SDI-1, redação original, para horas anteriores a 20/03/2023).',
      'FGTS sobre férias indenizadas não incide (OJ 195 da SDI-1).',
    ],
    warnings: [
      'Estimativa por média mensal. A liquidação de sentença usa os cartões de ponto, mês a mês, e os dias úteis reais para o DSR.',
    ],
  };
}
