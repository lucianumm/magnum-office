// Shared by the validation (backend) and the forms (frontend), so both accept the same values.
export const caseAreas = [
  'Cível',
  'Trabalhista',
  'Família',
  'Previdenciário',
  'Tributário',
  'Criminal',
  'Consumidor',
  'Empresarial',
  'Administrativo',
  'Ambiental',
  'Eleitoral',
  'Outros',
];
export const caseChoices = {
  personType: ['Física', 'Jurídica'],
  clientRole: ['', 'Polo ativo', 'Polo passivo', 'Terceiro interessado'],
  instance: ['', '1º grau', '2º grau', 'Tribunal superior', 'Juizado especial', 'Turma recursal', 'Administrativa'],
  phase: ['', 'Pré-processual', 'Conhecimento', 'Recursal', 'Cumprimento de sentença', 'Execução', 'Encerrada'],
};
// People involved in cases who are not clients.
export const personRoles = [
  'Parte contrária',
  'Advogado da parte contrária',
  'Testemunha',
  'Perito',
  'Assistente técnico',
  'Correspondente',
  'Servidor / cartório',
  'Outro',
];
// Financial entries: fees received and expenses of the office or of the case.
export const financeCategories = {
  Receita: [
    'Honorário contratual',
    'Honorário de êxito',
    'Honorário de sucumbência',
    'Consulta',
    'Reembolso de despesa',
    'Outra receita',
  ],
  Despesa: [
    'Custas processuais',
    'Diligência',
    'Cópias e autenticações',
    'Deslocamento',
    'Perícia',
    'Correspondente',
    'Outra despesa',
  ],
};
export const paymentMethods = ['', 'Pix', 'Transferência', 'Boleto', 'Dinheiro', 'Cartão', 'Outro'];
// Intakes: people who came for advice and may become clients.
export const intakeStatuses = ['Novo', 'Em análise', 'Proposta enviada', 'Contratado', 'Não contratado'];
export const intakeSources = [
  '',
  'Indicação',
  'Site',
  'Redes sociais',
  'WhatsApp',
  'Passante',
  'Cliente antigo',
  'Outro',
];
// Suggestions only; the field accepts any text (e.g. "união estável").
export const maritalStatuses = [
  'solteiro(a)',
  'casado(a)',
  'divorciado(a)',
  'viúvo(a)',
  'separado(a) judicialmente',
  'em união estável',
];
