import {
  Code2,
  Users,
  Workflow,
  Globe,
  PanelsTopLeft,
  FileSignature,
  ChartNoAxesCombined,
  MessageCircle,
  Database,
  ShoppingBag,
  Plug,
} from 'lucide-react';
import { Button, PageHeading } from './components.jsx';
const services = [
  [
    'Sistemas para empresas',
    Code2,
    'Cadastros, financeiro, estoque, atendimento, processos internos e painéis de gestão adaptados à rotina da sua empresa.',
  ],
  [
    'Equipes e uso coletivo',
    Users,
    'Acesso compartilhado, perfis de usuário, permissões, tarefas e colaboração entre setores.',
  ],
  [
    'Automações e integrações',
    Workflow,
    'Integração de sistemas, APIs, rotinas de trabalho, notificações e redução de tarefas repetitivas.',
  ],
  [
    'Websites e presença digital',
    Globe,
    'Sites institucionais, portfólios, páginas de serviços e experiências responsivas para apresentar seu negócio.',
  ],
  [
    'Landing pages e captação',
    PanelsTopLeft,
    'Páginas para campanhas, formulários, agendamentos e organização de oportunidades comerciais.',
  ],
  [
    'Assinaturas e documentos',
    FileSignature,
    'Fluxos de aprovação, gestão de contratos e integração com plataformas de assinatura.',
  ],
  [
    'Relatórios e indicadores',
    ChartNoAxesCombined,
    'Dashboards, relatórios e visualização dos dados que ajudam a acompanhar resultados.',
  ],
  [
    'Atendimento e relacionamento',
    MessageCircle,
    'Organização de contatos, lembretes, comunicações e integração com canais de atendimento.',
  ],
  [
    'Dados e ferramentas internas',
    Database,
    'Importação, organização e migração de dados, portais internos e ferramentas sob medida.',
  ],
  [
    'Portais e serviços por assinatura',
    ShoppingBag,
    'Áreas de clientes, catálogos, plataformas de serviços e integração com meios de pagamento.',
  ],
  [
    'APIs e agentes',
    Plug,
    'Conexão entre ferramentas, agentes e sistemas existentes, conforme as necessidades do projeto.',
  ],
];
export default function Services({ act }) {
  return (
    <>
      <PageHeading title="Lucianum Magnum" />
      <section className="services-hero">
        <img src="./app-icon.png" alt="Marca Lucianum Magnum" />
        <div>
          <h2>Um sistema pensado para a sua empresa.</h2>
          <p>
            Quer uma solução própria, uso coletivo pela equipe ou automações para a rotina do negócio? Vamos conversar
            sobre o que você precisa e desenhar um projeto adequado ao seu trabalho.
          </p>
          <Button icon={MessageCircle} onClick={() => act(() => window.advocacia.openLink('services'))}>
            Conversar com Lucianum · (64) 99268-4429
          </Button>
          <small>
            Entre em contato para avaliar escopo, prazo e proposta. Desenvolvimento e serviços profissionais são
            contratados à parte.
          </small>
        </div>
      </section>
      <div className="services-grid">
        {services.map(([title, Icon, description]) => (
          <article className="service-card" key={title}>
            <Icon size={24} />
            <h3>{title}</h3>
            <p>{description}</p>
          </article>
        ))}
      </div>
      <p className="help-text">
        Este aplicativo de gestão continua independente e gratuito. O contato profissional é opcional.
      </p>
    </>
  );
}
