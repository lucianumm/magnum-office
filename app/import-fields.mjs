// Spreadsheet import: fields of each kind, their labels and the column names recognised for them
// (also the headings commonly exported by other legal management systems). Shared by the screen and
// the main process, so both map columns the same way.
export const normalizeHeader = s =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

export const importFields = {
  clients: [
    'name',
    'birthDate',
    'email',
    'phone',
    'document',
    'nationality',
    'maritalStatus',
    'profession',
    'rg',
    'zip',
    'street',
    'addressNumber',
    'district',
    'city',
    'state',
    'address',
    'notes',
  ],
  tasks: ['title', 'due', 'date', 'time', 'type', 'priority', 'notes'],
  cases: [
    'title',
    'number',
    'clientName',
    'opposingParty',
    'opposingDocument',
    'county',
    'court',
    'area',
    'status',
    'phase',
    'procedure',
    'claimValue',
    'filedAt',
    'caseNotes',
  ],
};

export const importLabels = {
  birthDate: 'Data de nascimento',
  name: 'Nome',
  email: 'E-mail',
  phone: 'WhatsApp com DDD (obrigatório)',
  document: 'CPF / CNPJ',
  nationality: 'Nacionalidade',
  maritalStatus: 'Estado civil',
  profession: 'Profissão',
  rg: 'RG',
  zip: 'CEP',
  street: 'Logradouro',
  addressNumber: 'Número do endereço',
  district: 'Bairro',
  city: 'Cidade',
  state: 'UF',
  address: 'Endereço completo (texto)',
  notes: 'Observações',
  title: 'Título / assunto',
  due: 'Data e hora juntas',
  date: 'Data separada',
  time: 'Hora separada',
  type: 'Tipo',
  priority: 'Prioridade',
  number: 'Número do processo',
  clientName: 'Cliente (nome já cadastrado)',
  opposingParty: 'Parte contrária',
  opposingDocument: 'CPF / CNPJ da parte contrária',
  county: 'Comarca',
  court: 'Vara / órgão julgador',
  area: 'Área',
  status: 'Situação',
  phase: 'Fase',
  procedure: 'Classe / rito',
  claimValue: 'Valor da causa',
  filedAt: 'Data de distribuição',
  caseNotes: 'Observações',
};

const common = {
  notes: ['observacoes', 'notas', 'descricao', 'description', 'notes', 'anotacoes'],
};
export const importAliases = {
  clients: {
    birthDate: ['datanascimento', 'datadenascimento', 'nascimento', 'aniversario', 'birthday', 'birthdate'],
    name: ['nome', 'nomecompleto', 'cliente', 'name', 'fullname', 'razaosocial'],
    email: ['email', 'emailaddress', 'correioeletronico'],
    phone: ['telefone', 'celular', 'whatsapp', 'phone', 'mobile', 'fone'],
    document: ['documento', 'cpf', 'cnpj', 'cpfcnpj'],
    nationality: ['nacionalidade'],
    maritalStatus: ['estadocivil'],
    profession: ['profissao', 'ocupacao'],
    rg: ['rg', 'identidade', 'cedulaidentidade'],
    zip: ['cep'],
    street: ['logradouro', 'rua'],
    addressNumber: ['numero', 'numeroendereco'],
    district: ['bairro'],
    city: ['cidade', 'municipio'],
    state: ['uf', 'estado'],
    address: ['endereco', 'address'],
    ...common,
  },
  tasks: {
    title: ['titulo', 'assunto', 'compromisso', 'subject', 'summary', 'title'],
    due: ['dataehora', 'inicio', 'datainicio', 'start', 'startdate', 'due', 'vencimento'],
    date: ['data', 'date', 'dia'],
    time: ['hora', 'horario', 'time', 'starttime'],
    type: ['tipo', 'type'],
    priority: ['prioridade', 'priority'],
    ...common,
  },
  cases: {
    title: ['titulo', 'acao', 'tipodeacao', 'objeto', 'assunto', 'pasta', 'nomedoprocesso'],
    number: ['numerodoprocesso', 'numeroprocesso', 'processo', 'numerocnj', 'cnj', 'numero', 'nprocesso'],
    clientName: ['cliente', 'nomedocliente', 'clientes', 'partecliente', 'cliente1'],
    opposingParty: ['partecontraria', 'reu', 're', 'reclamada', 'requerido', 'requerida', 'adverso', 'partesadversas'],
    opposingDocument: ['cpfcnpjpartecontraria', 'cnpjpartecontraria', 'documentopartecontraria', 'cnpjreu'],
    county: ['comarca', 'foro', 'municipio', 'cidade'],
    court: ['vara', 'juizo', 'orgaojulgador', 'orgao', 'tribunalvara'],
    area: ['area', 'areadodireito', 'natureza', 'areadeatuacao'],
    status: ['situacao', 'status', 'situacaodoprocesso'],
    phase: ['fase', 'etapa', 'faseprocessual'],
    procedure: ['classe', 'rito', 'classeprocessual', 'procedimento'],
    claimValue: ['valordacausa', 'valorcausa', 'valor'],
    filedAt: ['datadedistribuicao', 'distribuicao', 'dataajuizamento', 'ajuizamento', 'datadistribuicao'],
    caseNotes: ['observacoes', 'notas', 'anotacoes', 'obs'],
  },
};

// Column index for each field from the sheet headings (-1 when there is none).
export const mapHeaders = (kind, headers) =>
  Object.fromEntries(
    importFields[kind].map(field => [
      field,
      headers.findIndex(h => (importAliases[kind][field] || []).includes(normalizeHeader(h))),
    ]),
  );
