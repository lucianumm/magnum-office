// Starting templates added once to the library. They are editable drafts: each office should review
// them before use. {variables} come from the records; {?questions} are asked when generating.
const center = s => `<p style="text-align: center">${s}</p>`;
const p = s => `<p>${s}</p>`;
const signature = (name, extra = '') =>
  center('<br>') + center('____________________________________') + center(name) + (extra ? center(extra) : '');
const place = center('{escritorio.cidade}, {data.extenso}.');

module.exports = [
  {
    group: 'Constitutivos',
    title: 'Procuração ad judicia et extra',
    html: [
      '<h1>PROCURAÇÃO AD JUDICIA ET EXTRA</h1>',
      p('<strong>OUTORGANTE:</strong> {cliente.qualificacao}.'),
      p('<strong>OUTORGADO(S):</strong> {advogados.qualificacao}, com escritório profissional em {escritorio.endereco}, onde recebe(m) intimações.'),
      p('<strong>PODERES:</strong> pelo presente instrumento, o(a) outorgante nomeia e constitui o(s) outorgado(s) seu(s) procurador(es), a quem confere os poderes da cláusula <em>ad judicia et extra</em>, para o foro em geral, em qualquer juízo, instância ou tribunal, podendo propor as ações competentes e defendê-lo(a) nas contrárias, seguindo umas e outras até final decisão, usando os recursos legais e acompanhando-os, e ainda os poderes especiais para confessar, reconhecer a procedência do pedido, transigir, desistir, renunciar ao direito sobre o qual se funda a ação, receber, dar quitação, firmar compromisso e assinar declaração de hipossuficiência econômica (art. 105 do Código de Processo Civil), podendo substabelecer, com ou sem reserva de poderes.'),
      p('<strong>FINALIDADE:</strong> {?Finalidade da procuração}.'),
      place,
      signature('{cliente.nome}'),
    ].join(''),
  },
  {
    group: 'Constitutivos',
    title: 'Substabelecimento com reserva de poderes',
    html: [
      '<h1>SUBSTABELECIMENTO COM RESERVA DE PODERES</h1>',
      p('Pelo presente instrumento, {advogados.qualificacao}, substabelece(m), <strong>com reserva de iguais poderes</strong>, a {?Nome, qualificação e OAB do(a) advogado(a) substabelecido(a)}, os poderes que lhe(s) foram conferidos por {cliente.nome}, nos autos do processo nº {processo.numero}, em trâmite perante {processo.juizo}.'),
      place,
      signature('{advogado.nome}', '{advogado.oab}'),
    ].join(''),
  },
  {
    group: 'Contratos',
    title: 'Contrato de honorários advocatícios',
    html: [
      '<h1>CONTRATO DE PRESTAÇÃO DE SERVIÇOS ADVOCATÍCIOS</h1>',
      p('<strong>CONTRATANTE:</strong> {cliente.qualificacao}.'),
      p('<strong>CONTRATADO(S):</strong> {advogados.qualificacao}, com escritório profissional em {escritorio.endereco}.'),
      p('As partes acima identificadas celebram o presente contrato de prestação de serviços advocatícios, que se regerá pelas cláusulas seguintes.'),
      p('<strong>CLÁUSULA 1ª – DO OBJETO.</strong> O(s) contratado(s) prestará(ão) ao contratante serviços profissionais de advocacia para {?Objeto do contrato (serviço a ser prestado)}.'),
      p('<strong>CLÁUSULA 2ª – DOS HONORÁRIOS.</strong> Pelos serviços contratados, o contratante pagará honorários de {?Valor dos honorários:moeda}, da seguinte forma: {?Forma de pagamento}.'),
      p('<strong>CLÁUSULA 3ª – DOS HONORÁRIOS DE SUCUMBÊNCIA.</strong> Os honorários de sucumbência pertencem ao(s) contratado(s), sem prejuízo dos honorários pactuados neste contrato, nos termos do art. 23 da Lei nº 8.906/1994.'),
      p('<strong>CLÁUSULA 4ª – DAS DESPESAS.</strong> Custas, emolumentos, perícias, cópias, deslocamentos e demais despesas necessárias à execução dos serviços correm por conta do contratante e não estão incluídas nos honorários.'),
      p('<strong>CLÁUSULA 5ª – DAS OBRIGAÇÕES DO CONTRATANTE.</strong> O contratante se obriga a fornecer, em tempo hábil, documentos e informações verdadeiros e completos, e a manter atualizados seus dados de contato.'),
      p('<strong>CLÁUSULA 6ª – DA RESCISÃO.</strong> A revogação do mandato ou a rescisão deste contrato por iniciativa do contratante não o desobriga do pagamento dos honorários proporcionais aos serviços já prestados.'),
      p('<strong>CLÁUSULA 7ª – DO FORO.</strong> Fica eleito o foro da comarca de {escritorio.cidade} para dirimir as questões oriundas deste contrato.'),
      p('E, por estarem justos e contratados, assinam o presente em duas vias de igual teor, na presença de duas testemunhas.'),
      place,
      signature('{cliente.nome}', 'CONTRATANTE'),
      signature('{advogados.nomes}', 'CONTRATADO(S)'),
      p('<br>'),
      p('Testemunhas:'),
      p('1. _______________________________ CPF: _______________'),
      p('2. _______________________________ CPF: _______________'),
    ].join(''),
  },
  {
    group: 'Outros',
    title: 'Declaração de hipossuficiência econômica',
    html: [
      '<h1>DECLARAÇÃO DE HIPOSSUFICIÊNCIA ECONÔMICA</h1>',
      p('{cliente.qualificacao}, <strong>DECLARA</strong>, para os fins dos arts. 98 e 99 do Código de Processo Civil, que não possui condições de arcar com as custas e despesas processuais e com os honorários advocatícios sem prejuízo do próprio sustento e do de sua família, razão pela qual requer os benefícios da gratuidade da justiça.'),
      p('Declara, ainda, estar ciente de que a falsidade desta declaração sujeita o(a) declarante às sanções civis, administrativas e penais cabíveis.'),
      place,
      signature('{cliente.nome}'),
    ].join(''),
  },
  {
    group: 'Outros',
    title: 'Recibo de honorários',
    html: [
      '<h1>RECIBO</h1>',
      p('Recebi(emos) de {cliente.nome}, inscrito(a) no CPF/CNPJ sob o nº {cliente.cpf_cnpj}, a importância de {?Valor recebido:moeda}, referente a {?Referente a}, pelo que dou(damos) plena quitação quanto ao valor recebido.'),
      place,
      signature('{advogado.nome}', '{advogado.oab}'),
    ].join(''),
  },
];
