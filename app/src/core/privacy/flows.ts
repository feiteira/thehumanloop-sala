import { LOOP_AVAILABLE } from '../../loopEdition';
import type { UiLocale } from '../i18n/locales';

// Every way data can leave the device. This single list feeds the in-app
// "What leaves this device" screen and PRIVACY.md (npm run gen:privacy), so the two
// cannot drift apart. Adding a feature that sends data anywhere means adding it here.

export interface FlowText {
  title: string;
  when: string;
  what: string;
  who: string;
}

export interface Flow {
  id: 'backup' | 'export' | 'calendar' | 'document-copy' | 'loop' | 'interest' | 'updates';
  /** 'setting': on while a setting is on; 'action': only when you do it. */
  trigger: 'setting' | 'action';
  text: Record<UiLocale, FlowText>;
}

const ALL_FLOWS: Flow[] = [
  {
    id: 'backup',
    trigger: 'setting',
    text: {
      en: {
        title: 'Backup file',
        when: 'When Sala opens, once a day, and when you lock or close it, if anything changed — only after you choose a backup folder.',
        what: 'The whole practice, encrypted, including what you deleted in the last 30 days, written to the folder you chose (a USB drive or your own cloud-drive folder).',
        who: 'Only someone who knows your passphrase or recovery phrase.',
      },
      pt: {
        title: 'Ficheiro de cópia de segurança',
        when: 'Quando o Sala abre, uma vez por dia e quando o bloqueia ou fecha, se algo mudou — só depois de escolher uma pasta para as cópias.',
        what: 'Toda a prática, cifrada, incluindo o que eliminou nos últimos 30 dias, gravada na pasta que escolheu (uma pen USB ou uma pasta da sua própria nuvem).',
        who: 'Apenas quem souber a sua frase-passe ou a sua frase de recuperação.',
      },
      es: {
        title: 'Archivo de copia de seguridad',
        when: 'Al abrir Sala, una vez al día y al bloquearlo o cerrarlo, si algo ha cambiado — solo después de elegir una carpeta para las copias.',
        what: 'Toda la consulta, cifrada, incluido lo que eliminó en los últimos 30 días, guardada en la carpeta que eligió (un USB o una carpeta de su propia nube).',
        who: 'Solo quien conozca su frase de acceso o su frase de recuperación.',
      },
    },
  },
  {
    id: 'export',
    trigger: 'action',
    text: {
      en: {
        title: 'Export file (.sala)',
        when: 'Only when you choose Export everything, or Export this folder… on a folder.',
        what: 'All folders, pages, sticky notes, appointments and documents, without the content of anything you deleted — or, for one folder, only that folder: its cover, pages, sticky notes, appointments and, if you choose, documents. Private process notes only if you tick the box.',
        who: 'Anyone who has the file — unless you protect it with a password.',
      },
      pt: {
        title: 'Ficheiro de exportação (.sala)',
        when: 'Só quando escolhe Exportar tudo, ou Exportar esta pasta… numa pasta.',
        what: 'Todas as pastas, páginas, notas adesivas, marcações e documentos, sem o conteúdo do que eliminou — ou, para uma pasta, só essa pasta: a capa, as páginas, as notas adesivas, as marcações e, se quiser, os documentos. As notas de processo privadas só se assinalar a opção.',
        who: 'Quem tiver o ficheiro — a menos que o proteja com uma palavra-passe.',
      },
      es: {
        title: 'Archivo de exportación (.sala)',
        when: 'Solo cuando elige Exportar todo, o Exportar esta carpeta… en una carpeta.',
        what: 'Todas las carpetas, páginas, notas adhesivas, citas y documentos, sin el contenido de lo que eliminó — o, para una carpeta, solo esa carpeta: la portada, las páginas, las notas adhesivas, las citas y, si lo elige, los documentos. Las notas de proceso privadas solo si marca la casilla.',
        who: 'Quien tenga el archivo — salvo que lo proteja con una contraseña.',
      },
    },
  },
  {
    id: 'calendar',
    trigger: 'action',
    text: {
      en: {
        title: 'Calendar file (.ics)',
        when: 'Only when you choose Export calendar.',
        what: 'Appointment dates, times and places, titled as you choose (initials only by default). No notes.',
        who: 'Anyone who has the file, and the calendar program you open it in.',
      },
      pt: {
        title: 'Ficheiro de calendário (.ics)',
        when: 'Só quando escolhe Exportar calendário.',
        what: 'Datas, horas e locais das marcações, com o título que escolher (por omissão, só as iniciais). Sem notas.',
        who: 'Quem tiver o ficheiro e o programa de calendário onde o abrir.',
      },
      es: {
        title: 'Archivo de calendario (.ics)',
        when: 'Solo cuando elige Exportar calendario.',
        what: 'Fechas, horas y lugares de las citas, con el título que elija (por defecto, solo las iniciales). Sin notas.',
        who: 'Quien tenga el archivo y el programa de calendario en que lo abra.',
      },
    },
  },
  {
    id: 'document-copy',
    trigger: 'action',
    text: {
      en: {
        title: 'Saved copy of a document',
        when: 'Only when you choose Save on a document.',
        what: 'That one document, unencrypted, in the place you choose.',
        who: 'Anyone with access to that place.',
      },
      pt: {
        title: 'Cópia guardada de um documento',
        when: 'Só quando escolhe Guardar num documento.',
        what: 'Esse documento, sem cifra, no local que escolher.',
        who: 'Quem tiver acesso a esse local.',
      },
      es: {
        title: 'Copia guardada de un documento',
        when: 'Solo cuando elige Guardar en un documento.',
        what: 'Ese documento, sin cifrar, en el lugar que elija.',
        who: 'Quien tenga acceso a ese lugar.',
      },
    },
  },
  {
    id: 'loop',
    trigger: 'setting',
    text: {
      en: {
        title: 'The Human Loop',
        when: 'Only after you join The Human Loop, while you are signed in and open a patient’s companion or your patient list.',
        what: 'Your sign-in, and requests for your patients’ companion information. Changes you make there (curation, chat, pairing) are sent to The Human Loop. Your folders, pages and sticky notes are never sent, and neither is which folder belongs to which patient.',
        who: 'The Human Loop, as for its therapist app. What it shows you is kept in memory only, not saved on this computer.',
      },
      pt: {
        title: 'The Human Loop',
        when: 'Só depois de se ligar ao The Human Loop, enquanto tiver sessão iniciada e abrir o companheiro de um paciente ou a sua lista de pacientes.',
        what: 'O seu início de sessão e os pedidos de informação do companheiro dos seus pacientes. As alterações que fizer aí (curadoria, conversa, emparelhamento) são enviadas ao The Human Loop. As suas pastas, páginas e notas adesivas nunca são enviadas, nem a associação entre pastas e pacientes.',
        who: 'O The Human Loop, tal como na sua aplicação para terapeutas. O que lhe mostra fica apenas em memória e não é guardado neste computador.',
      },
      es: {
        title: 'The Human Loop',
        when: 'Solo después de conectarse a The Human Loop, mientras tenga la sesión iniciada y abra el acompañante de un paciente o su lista de pacientes.',
        what: 'Su inicio de sesión y las solicitudes de información del acompañante de sus pacientes. Los cambios que haga allí (curación, conversación, emparejamiento) se envían a The Human Loop. Sus carpetas, páginas y notas adhesivas nunca se envían, ni qué carpeta corresponde a qué paciente.',
        who: 'The Human Loop, como en su aplicación para terapeutas. Lo que le muestra se guarda solo en memoria, no en este ordenador.',
      },
    },
  },
  {
    id: 'interest',
    trigger: 'action',
    text: {
      en: {
        title: 'Keep me updated (The Human Loop)',
        when: 'Only when you fill in “Keep me updated” on The Human Loop page (in the menu) and press Send.',
        what: 'The name, email address and note you type, and Sala’s language. Nothing from your practice.',
        who: 'The Human Loop, to write to you. It emails you a thank-you and deletes your details on request.',
      },
      pt: {
        title: 'Receber novidades (The Human Loop)',
        when: 'Só quando preenche “Quero receber novidades” na página The Human Loop (no menu) e carrega em Enviar.',
        what: 'O nome, o endereço de email e a nota que escrever, e o idioma do Sala. Nada da sua prática.',
        who: 'O The Human Loop, para lhe escrever. Envia-lhe um email de agradecimento e apaga os seus dados se o pedir.',
      },
      es: {
        title: 'Recibir novedades (The Human Loop)',
        when: 'Solo cuando rellena «Quiero recibir novedades» en la página The Human Loop (en el menú) y pulsa Enviar.',
        what: 'El nombre, la dirección de correo y la nota que escriba, y el idioma de Sala. Nada de su consulta.',
        who: 'The Human Loop, para escribirle. Le envía un correo de agradecimiento y borra sus datos si lo pide.',
      },
    },
  },
  {
    id: 'updates',
    trigger: 'setting',
    text: {
      en: {
        title: 'Check for new versions',
        when: 'Once a day, only if you turn on “Check for new versions once a day” (Settings → About Sala), and when you press Check now.',
        what: 'A request for the public file that names Sala’s latest version. Nothing from your practice; like any web request, it shows your internet address.',
        who: 'Sala’s website, sala.thehumanloop.eu — as when you visit it in a browser.',
      },
      pt: {
        title: 'Procurar novas versões',
        when: 'Uma vez por dia, só se ativar “Procurar novas versões uma vez por dia” (Definições → Sobre o Sala), e quando carrega em Procurar agora.',
        what: 'Um pedido do ficheiro público que indica a versão mais recente do Sala. Nada da sua prática; como qualquer pedido na Internet, mostra o seu endereço de Internet.',
        who: 'O site do Sala, sala.thehumanloop.eu — tal como quando o visita no navegador.',
      },
      es: {
        title: 'Buscar versiones nuevas',
        when: 'Una vez al día, solo si activa «Buscar versiones nuevas una vez al día» (Ajustes → Acerca de Sala), y cuando pulsa Buscar ahora.',
        what: 'Una petición del archivo público que indica la última versión de Sala. Nada de su consulta; como cualquier petición en Internet, muestra su dirección de Internet.',
        who: 'El sitio web de Sala, sala.thehumanloop.eu — igual que cuando lo visita en el navegador.',
      },
    },
  },
];

/** The flows that exist only where Sala has its connection to The Human Loop. */
const LOOP_FLOWS: ReadonlySet<Flow['id']> = new Set<Flow['id']>(['loop', 'interest']);

export const FLOWS: Flow[] = ALL_FLOWS.filter((f) => LOOP_AVAILABLE || !LOOP_FLOWS.has(f.id));

const NO_NETWORK_WITH_LOOP: Record<UiLocale, string> = {
  en: 'Sala makes no internet connections unless you join The Human Loop, ask it to keep you updated, or turn on the check for new versions — and then only to The Human Loop or Sala’s website. There are no analytics, telemetry or crash reports. Your practice stays on this computer, encrypted.',
  pt: 'O Sala não faz ligações à Internet, a menos que se ligue ao The Human Loop, lhe peça novidades ou ative a procura de novas versões — e, nesse caso, só ao The Human Loop ou ao site do Sala. Não há estatísticas de utilização, telemetria nem relatórios de erros. A sua prática fica neste computador, cifrada.',
  es: 'Sala no se conecta a Internet salvo que usted se conecte a The Human Loop, le pida novedades o active la búsqueda de versiones nuevas, y en ese caso solo a The Human Loop o al sitio web de Sala. No hay analíticas, telemetría ni informes de errores. Su consulta se queda en este ordenador, cifrada.',
};

const NO_NETWORK_SALA_ONLY: Record<UiLocale, string> = {
  en: 'Sala makes no internet connections unless you turn on the check for new versions — and then only to Sala’s website. There are no analytics, telemetry or crash reports. Your practice stays on this computer, encrypted.',
  pt: 'O Sala não faz ligações à Internet, a menos que ative a procura de novas versões — e, nesse caso, só ao site do Sala. Não há estatísticas de utilização, telemetria nem relatórios de erros. A sua prática fica neste computador, cifrada.',
  es: 'Sala no se conecta a Internet salvo que usted active la búsqueda de versiones nuevas, y en ese caso solo al sitio web de Sala. No hay analíticas, telemetría ni informes de errores. Su consulta se queda en este ordenador, cifrada.',
};

export const NO_NETWORK: Record<UiLocale, string> = LOOP_AVAILABLE ? NO_NETWORK_WITH_LOOP : NO_NETWORK_SALA_ONLY;
