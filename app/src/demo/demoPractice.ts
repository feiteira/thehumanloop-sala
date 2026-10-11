import { DateTime } from 'luxon';
import type { UiLocale } from '../core/i18n/locales';
import { uuid } from '../core/ids';
import { uniqueThemes } from '../core/model/passages';
import type { Base, Draft, Entity, FolderColour, Passage, PortraitLook, StickyColour, Template } from '../core/model/types';
import { emptyContact } from '../core/model/types';
import type { Store } from '../core/store/store';
import { setSetting, SETTING } from '../services/settings';
import { KNOWN_THEMES_SETTING } from '../services/themes';

// A fictional practice for the demo, the manual's screenshots and the store listings.
// Every name and note is invented. Never put real patient data here.

interface FolderSeed {
  label: string;
  colour: FolderColour;
  tags: Record<UiLocale, string[]>;
  cover: Record<UiLocale, string>;
  /** weekday (1 = Monday), time, weeks between sessions */
  slot: [number, string, 1 | 2] | null;
  /** A new patient: one first consultation, on this week's Monday at this time. */
  firstConsultation?: string;
  notes: { text: Record<UiLocale, string>; colour: StickyColour; next: boolean }[];
  /** Notes of past sessions: `ago` 1 is the latest session before today, 2 the one before. */
  pages: { ago: number; template: Template; title: Record<UiLocale, string>; sections: Record<UiLocale, Record<string, string>> }[];
  /**
   * Why they came, for the intake page of their first session. Every session between that one
   * and the pages above gets a short note, so the folder's pages are numbered from 1.
   */
  reason?: Record<UiLocale, string>;
  /** Words of these pages marked with themes; `ago` as in `pages`, or the intake page. */
  marks?: { ago: number | 'intake'; section: string; words: Record<UiLocale, string>; themes: Record<UiLocale, string[]> }[];
  archived?: boolean;
  /** Invented; example.org is reserved for examples. */
  email?: string;
}

// The drawn portrait each invented person gets (the therapist picks these in a real practice).
const LOOKS: Record<string, PortraitLook> = {
  'Inês Salgado': 'feminine', 'Rui Marques': 'masculine', 'Laura Costa': 'feminine', 'Tomás Ferreira': 'masculine',
  'Beatriz Nunes': 'feminine', 'Carlos Duarte': 'masculine', 'Helena Rocha': 'feminine', 'João Pires': 'masculine',
};

const L = (en: string, pt: string, es: string): Record<UiLocale, string> => ({ en, pt, es });
const T = (en: string[], pt: string[], es: string[]): Record<UiLocale, string[]> => ({ en, pt, es });

// Themes marked on the demo pages.
const SLEEP = T(['sleep'], ['sono'], ['sueño']);
const WORRY = T(['worry'], ['preocupação'], ['preocupación']);
const WORK = T(['work'], ['trabalho'], ['trabajo']);

const FOLDERS: FolderSeed[] = [
  {
    label: 'Inês Salgado', colour: 'teal', email: 'ines.salgado@example.org', tags: T(['sleep', 'anxiety'], ['sono', 'ansiedade'], ['sueño', 'ansiedad']),
    cover: L('Referred by her GP, March 2026', 'Encaminhada pelo médico de família, março de 2026', 'Derivada por su médico de cabecera, marzo de 2026'),
    slot: [1, '09:00', 1],
    reason: L('Hard to fall asleep for a year, worrying at night. Referred by her GP.', 'Dificuldade em dormir há um ano, com preocupações à noite. Encaminhada pelo médico de família.', 'Le cuesta dormir desde hace un año, con preocupaciones por la noche. Derivada por su médico de cabecera.'),
    marks: [
      { ago: 'intake', section: 'reason', words: L('Hard to fall asleep for a year', 'Dificuldade em dormir há um ano', 'Le cuesta dormir desde hace un año'), themes: SLEEP },
      { ago: 'intake', section: 'reason', words: L('worrying at night', 'preocupações à noite', 'preocupaciones por la noche'), themes: WORRY },
      { ago: 2, section: 'data', words: L('Two nights with less than four hours of sleep.', 'Duas noites com menos de quatro horas de sono.', 'Dos noches con menos de cuatro horas de sueño.'), themes: SLEEP },
      { ago: 2, section: 'assessment', words: L('Stress at work increased.', 'Aumento do stress no trabalho.', 'Aumento del estrés en el trabajo.'), themes: WORK },
      { ago: 1, section: 'data', words: L('Reports falling asleep after 1 a.m. most nights.', 'Refere adormecer depois da 1h na maioria das noites.', 'Refiere dormirse después de la 1 casi todas las noches.'), themes: SLEEP },
      {
        ago: 1, section: 'data',
        words: L('Worry about work deadlines is the main theme at bedtime.', 'A preocupação com prazos do trabalho é o tema principal à hora de deitar.', 'La preocupación por los plazos del trabajo es el tema principal al acostarse.'),
        themes: T(['worry', 'work'], ['preocupação', 'trabalho'], ['preocupación', 'trabajo']),
      },
      { ago: 1, section: 'plan', words: L('Introduce a “worry window” at 19:00.', 'Introduzir um “tempo para preocupações” às 19h.', 'Introducir un “rato para preocuparse” a las 19:00.'), themes: WORRY },
    ],
    notes: [
      { text: L('Ask about the sleep diary', 'Perguntar pelo diário do sono', 'Preguntar por el diario de sueño'), colour: 'yellow', next: true },
      { text: L('Mother’s surgery on the 14th', 'Cirurgia da mãe no dia 14', 'Operación de su madre el día 14'), colour: 'pink', next: false },
    ],
    pages: [
      {
        ago: 1, template: 'dap', title: L('The worry window', 'Tempo para preocupações', 'Un rato para preocuparse'),
        sections: {
          en: { data: 'Reports falling asleep after 1 a.m. most nights. Kept the sleep diary for 5 of 7 days. Worry about work deadlines is the main theme at bedtime.', assessment: 'Some progress with the wind-down routine; worry still drives the delay. Motivated.', plan: 'Continue the diary. Introduce a “worry window” at 19:00. Review next week.' },
          pt: { data: 'Refere adormecer depois da 1h na maioria das noites. Preencheu o diário do sono em 5 de 7 dias. A preocupação com prazos do trabalho é o tema principal à hora de deitar.', assessment: 'Algum progresso com a rotina de relaxamento; a preocupação continua a atrasar o sono. Motivada.', plan: 'Continuar o diário. Introduzir um “tempo para preocupações” às 19h. Rever na próxima semana.' },
          es: { data: 'Refiere dormirse después de la 1 casi todas las noches. Rellenó el diario de sueño 5 de 7 días. La preocupación por los plazos del trabajo es el tema principal al acostarse.', assessment: 'Algún progreso con la rutina de relajación; la preocupación sigue retrasando el sueño. Motivada.', plan: 'Seguir con el diario. Introducir un “rato para preocuparse” a las 19:00. Revisar la semana que viene.' },
        },
      },
      {
        ago: 2, template: 'dap', title: L('A hard week', 'Uma semana difícil', 'Una semana difícil'),
        sections: {
          en: { data: 'Difficult week. Two nights with less than four hours of sleep.', assessment: 'Stress at work increased.', plan: 'Start the sleep diary.' },
          pt: { data: 'Semana difícil. Duas noites com menos de quatro horas de sono.', assessment: 'Aumento do stress no trabalho.', plan: 'Começar o diário do sono.' },
          es: { data: 'Semana difícil. Dos noches con menos de cuatro horas de sueño.', assessment: 'Aumento del estrés en el trabajo.', plan: 'Empezar el diario de sueño.' },
        },
      },
    ],
  },
  {
    label: 'Rui Marques', colour: 'blue', tags: T(['students'], ['estudantes'], ['estudiantes']),
    cover: L('University student, 2nd year', 'Estudante universitário, 2.º ano', 'Estudiante universitario, 2.º curso'),
    slot: [1, '10:30', 1],
    reason: L('Anxiety before exams; falling behind in two subjects.', 'Ansiedade antes dos exames; atrasado em duas cadeiras.', 'Ansiedad antes de los exámenes; se está quedando atrás en dos asignaturas.'),
    marks: [
      { ago: 1, section: 'subjective', words: L('avoids the library', 'evita a biblioteca', 'evita la biblioteca'), themes: T(['avoidance'], ['evitamento'], ['evitación']) },
      { ago: 2, section: 'subjective', words: L('sleeps badly the night before classes', 'dorme mal na véspera das aulas', 'duerme mal la noche antes de las clases'), themes: SLEEP },
    ],
    notes: [{ text: L('Exam dates?', 'Datas dos exames?', '¿Fechas de los exámenes?'), colour: 'green', next: true }],
    pages: [
      {
        ago: 1, template: 'soap', title: L('Avoiding the library', 'Evitar a biblioteca', 'Evitar la biblioteca'),
        sections: {
          en: { subjective: 'Feels behind in two subjects; avoids the library.', objective: 'Arrived on time, calm, good eye contact.', assessment: 'Avoidance maintaining the anxiety.', plan: 'Graded exposure: 30 minutes in the library twice this week.' },
          pt: { subjective: 'Sente-se atrasado em duas cadeiras; evita a biblioteca.', objective: 'Chegou a horas, calmo, bom contacto visual.', assessment: 'O evitamento mantém a ansiedade.', plan: 'Exposição gradual: 30 minutos na biblioteca duas vezes esta semana.' },
          es: { subjective: 'Se siente atrasado en dos asignaturas; evita la biblioteca.', objective: 'Llegó puntual, tranquilo, buen contacto visual.', assessment: 'La evitación mantiene la ansiedad.', plan: 'Exposición gradual: 30 minutos en la biblioteca dos veces esta semana.' },
        },
      },
      {
        ago: 2, template: 'soap', title: L('Exam worries', 'Preocupação com os exames', 'Preocupación por los exámenes'),
        sections: {
          en: { subjective: 'Exams in three weeks; sleeps badly the night before classes.', objective: 'Restless at first, settled after ten minutes.', assessment: 'Anticipatory anxiety around assessment.', plan: 'Map the week: classes, study, rest. Bring the exam calendar.' },
          pt: { subjective: 'Exames daqui a três semanas; dorme mal na véspera das aulas.', objective: 'Inquieto no início, acalmou ao fim de dez minutos.', assessment: 'Ansiedade antecipatória em torno das avaliações.', plan: 'Mapear a semana: aulas, estudo, descanso. Trazer o calendário de exames.' },
          es: { subjective: 'Exámenes dentro de tres semanas; duerme mal la noche antes de las clases.', objective: 'Inquieto al principio, se calmó a los diez minutos.', assessment: 'Ansiedad anticipatoria en torno a las evaluaciones.', plan: 'Organizar la semana: clases, estudio, descanso. Traer el calendario de exámenes.' },
        },
      },
    ],
  },
  {
    label: 'Laura Costa', colour: 'coral', tags: T(['intake'], ['primeira consulta'], ['primera consulta']),
    cover: L('New — first consultation', 'Nova — primeira consulta', 'Nueva — primera consulta'), slot: null, firstConsultation: '14:00',
    notes: [{ text: L('Bring intake forms', 'Levar formulários de admissão', 'Llevar formularios de admisión'), colour: 'yellow', next: true }], pages: [],
  },
  {
    label: 'Miguel e Sofia Antunes', colour: 'plum', tags: T(['couples'], ['casal'], ['pareja']),
    cover: L('Couple, fortnightly', 'Casal, quinzenal', 'Pareja, quincenal'), slot: [2, '18:00', 2],
    reason: L('Frequent arguments; both want to understand what sets them off.', 'Discussões frequentes; ambos querem perceber o que as desencadeia.', 'Discusiones frecuentes; los dos quieren entender qué las desencadena.'),
    notes: [{ text: L('Revisit the “Sunday evenings” pattern', 'Retomar o padrão dos “domingos à noite”', 'Retomar el patrón de los “domingos por la noche”'), colour: 'blue', next: true }],
    pages: [
      {
        ago: 1, template: 'free', title: L('Sunday evenings', 'Domingos à noite', 'Domingos por la noche'),
        sections: {
          en: { body: 'Both describe Sunday evenings as the point where arguments start. Worked on noticing the first signs and taking a pause. Homework: agree on one Sunday plan together.' },
          pt: { body: 'Ambos descrevem os domingos à noite como o momento em que as discussões começam. Trabalhámos a identificação dos primeiros sinais e a pausa. Tarefa: combinarem juntos um plano para domingo.' },
          es: { body: 'Ambos describen los domingos por la noche como el momento en que empiezan las discusiones. Trabajamos en detectar las primeras señales y hacer una pausa. Tarea: acordar juntos un plan para el domingo.' },
        },
      },
    ],
  },
  {
    label: 'Tomás Ferreira', colour: 'sage', tags: T(['grief'], ['luto'], ['duelo']), cover: L('', '', ''), slot: [3, '11:00', 1],
    reason: L('Grief after his father’s death last October.', 'Luto após a morte do pai em outubro passado.', 'Duelo tras la muerte de su padre el pasado octubre.'),
    notes: [], pages: [
      {
        ago: 1, template: 'free', title: L('The workshop', 'A oficina', 'El taller'),
        sections: {
          en: { body: 'Talked about his father’s workshop and what to keep. First session where he laughed while remembering.' },
          pt: { body: 'Falámos da oficina do pai e do que guardar. Primeira sessão em que se riu ao recordar.' },
          es: { body: 'Hablamos del taller de su padre y de qué conservar. Primera sesión en la que se rió al recordar.' },
        },
      },
      {
        ago: 2, template: 'free', title: L('A year on', 'Um ano depois', 'Un año después'),
        sections: {
          en: { body: 'A year since his father’s death next month. Unsure whether to visit the workshop alone or with his sister.' },
          pt: { body: 'Faz um ano da morte do pai no próximo mês. Não sabe se vai à oficina sozinho ou com a irmã.' },
          es: { body: 'El mes que viene se cumple un año de la muerte de su padre. No sabe si ir al taller solo o con su hermana.' },
        },
      },
    ],
  },
  {
    label: 'Beatriz Nunes', colour: 'yellow', tags: T(['anxiety'], ['ansiedade'], ['ansiedad']), cover: L('', '', ''), slot: [4, '16:00', 1],
    reason: L('Panic attacks on the metro for three months.', 'Ataques de pânico no metro há três meses.', 'Ataques de pánico en el metro desde hace tres meses.'),
    notes: [{ text: L('Send breathing exercise audio', 'Enviar áudio do exercício de respiração', 'Enviar audio del ejercicio de respiración'), colour: 'green', next: false }],
    pages: [
      {
        ago: 1, template: 'dap', title: L('Stayed on the metro', 'Ficou no metro', 'Se quedó en el metro'),
        sections: {
          en: { data: 'Kept the log for five days. One episode, shorter; stayed on the metro.', assessment: 'First time she stayed in the situation. Pleased.', plan: 'Two short metro trips at a quiet hour. Send her the breathing exercise audio.' },
          pt: { data: 'Manteve o registo durante cinco dias. Um episódio, mais curto; ficou no metro.', assessment: 'Primeira vez que se manteve na situação. Satisfeita.', plan: 'Duas viagens curtas de metro a uma hora calma. Enviar-lhe o áudio do exercício de respiração.' },
          es: { data: 'Llevó el registro cinco días. Un episodio, más corto; se quedó en el metro.', assessment: 'Primera vez que se mantuvo en la situación. Contenta.', plan: 'Dos trayectos cortos en metro a una hora tranquila. Enviarle el audio del ejercicio de respiración.' },
        },
      },
      {
        ago: 2, template: 'dap', title: L('Panic on the metro', 'Pânico no metro', 'Pánico en el metro'),
        sections: {
          en: { data: 'Two panic episodes on the metro this week, both on the way to work.', assessment: 'Avoidance growing: took the bus twice.', plan: 'Practise the 4-6 breathing daily. Note each episode: time, place, what helped.' },
          pt: { data: 'Dois episódios de pânico no metro esta semana, ambos a caminho do trabalho.', assessment: 'O evitamento está a aumentar: apanhou o autocarro duas vezes.', plan: 'Praticar diariamente a respiração 4-6. Registar cada episódio: hora, local, o que ajudou.' },
          es: { data: 'Dos episodios de pánico en el metro esta semana, los dos de camino al trabajo.', assessment: 'La evitación va en aumento: cogió el autobús dos veces.', plan: 'Practicar a diario la respiración 4-6. Anotar cada episodio: hora, lugar, qué ayudó.' },
        },
      },
    ],
  },
  {
    label: 'Carlos Duarte', colour: 'grey', tags: T([], [], []), cover: L('', '', ''), slot: [4, '09:30', 2], notes: [],
    reason: L('Low mood since the separation; moving to Porto soon.', 'Humor em baixo desde a separação; vai mudar-se em breve para o Porto.', 'Ánimo bajo desde la separación; pronto se muda a Oporto.'),
    pages: [
      {
        ago: 1, template: 'free', title: L('The move to Porto', 'A mudança para o Porto', 'El traslado a Oporto'),
        sections: {
          en: { body: 'Talked about the move to Porto and the distance from his children. Wants to keep fortnightly sessions for now.' },
          pt: { body: 'Falámos da mudança para o Porto e da distância dos filhos. Quer manter as sessões quinzenais por agora.' },
          es: { body: 'Hablamos del traslado a Oporto y de la distancia con sus hijos. Quiere mantener las sesiones cada dos semanas por ahora.' },
        },
      },
    ],
  },
  {
    // Her latest session has no note yet: the one "note still to write" on Today.
    label: 'Helena Rocha', colour: 'sand', tags: T(['work stress'], ['stress laboral'], ['estrés laboral']), cover: L('', '', ''), slot: [5, '10:00', 1], notes: [],
    reason: L('Exhausted by work; cannot switch off in the evening.', 'Exausta com o trabalho; não consegue desligar à noite.', 'Agotada por el trabajo; no consigue desconectar por la noche.'),
    pages: [
      {
        ago: 2, template: 'free', title: L('Long hours', 'Horários longos', 'Jornadas largas'),
        sections: {
          en: { body: 'Long hours again; skipped lunch most days. Agreed on one fixed break a day and a walk after work on Wednesdays.' },
          pt: { body: 'Outra vez horários longos; saltou o almoço quase todos os dias. Combinámos uma pausa fixa por dia e uma caminhada depois do trabalho às quartas.' },
          es: { body: 'Otra vez jornadas largas; se saltó la comida casi todos los días. Acordamos una pausa fija al día y un paseo después del trabajo los miércoles.' },
        },
      },
    ],
  },
  { label: 'João Pires', colour: 'teal', tags: T(['sleep'], ['sono'], ['sueño']), cover: L('Finished June 2026', 'Terminou em junho de 2026', 'Terminó en junio de 2026'), slot: null, notes: [], pages: [], archived: true },
];

// Short notes for the sessions in between, and the plan agreed at intake.
const BETWEEN: Record<UiLocale, string>[] = [
  L('Went over the week and the homework. Same focus for now.', 'Revimos a semana e a tarefa. Por agora, o mesmo foco.', 'Repasamos la semana y la tarea. De momento, el mismo enfoque.'),
  L('Back to the goals set at the start. Small steps this week.', 'Voltámos aos objetivos do início. Pequenos passos esta semana.', 'Volvimos a los objetivos del principio. Pequeños pasos esta semana.'),
  L('Mostly the events of the week. No change to the plan.', 'Sobretudo os acontecimentos da semana. Sem mudanças no plano.', 'Sobre todo, lo que pasó en la semana. Sin cambios en el plan.'),
  L('Talked about what has helped so far, and what has not.', 'Falámos do que tem ajudado até agora e do que não tem.', 'Hablamos de lo que ha ayudado hasta ahora y de lo que no.'),
];
const INTAKE_PLAN: Record<1 | 2, Record<UiLocale, string>> = {
  1: L('Weekly sessions. Review the goals in two months.', 'Sessões semanais. Rever os objetivos daqui a dois meses.', 'Sesiones semanales. Revisar los objetivos dentro de dos meses.'),
  2: L('Sessions every two weeks. Review the goals in two months.', 'Sessões quinzenais. Rever os objetivos daqui a dois meses.', 'Sesiones cada dos semanas. Revisar los objetivos dentro de dos meses.'),
};

const TYPE_FIRST = '00000000-0000-4000-9000-000000000001';
const TYPE_SESSION = '00000000-0000-4000-9000-000000000002';

type SeedKind = 'folder' | 'page' | 'sticky' | 'appointment' | 'availability' | 'appointment_type';

/**
 * Seeds the fictional practice around `today` (now, in Lisbon). Every series started six
 * weeks before this week, and every session held since has its page (an intake page first),
 * except Helena Rocha's latest. Notes and pages are dated as if written at the end of the
 * session they belong to, so "next session" notes come up on the right day.
 */
export async function seedDemoPractice(store: Store, locale: UiLocale, today: DateTime): Promise<void> {
  const tz = 'Europe/Lisbon';
  await setSetting(store, SETTING.timeZone, tz);
  const now = today.setZone(tz);
  const dayStart = now.startOf('day');
  const monday = now.startOf('week');

  const drafts: { kind: SeedKind; draft: Draft<never>; written?: DateTime }[] = [];
  const themesUsed: string[] = [];
  const push = <K extends SeedKind>(kind: K, draft: Draft<K>, written?: DateTime) => drafts.push({ kind, draft: draft as unknown as Draft<never>, written });
  const at = (date: DateTime, time: string) => DateTime.fromISO(`${date.toISODate()}T${time}`, { zone: tz });

  for (const [i, f] of FOLDERS.entries()) {
    const id = `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`;
    push('folder', {
      id, label: f.label, colour: f.colour, status: f.archived ? 'archived' : 'active', tags: f.tags[locale], contact: { ...emptyContact(), email: f.email ?? '' },
      cover_note: f.cover[locale], archived_at: f.archived ? '2026-06-30T12:00:00.000Z' : null, merged_into: null,
      picture: { kind: 'drawn', seed: f.label, look: LOOKS[f.label] ?? 'any' },
    });
    // Sessions held before today, the latest first.
    const past: DateTime[] = [];
    if (f.slot) {
      const [weekday, time, weeks] = f.slot;
      const first = monday.minus({ weeks: 6 }).plus({ days: weekday - 1 });
      for (let d = first; at(d, time) < dayStart; d = d.plus({ weeks })) past.unshift(at(d, time));
      push('appointment', {
        folder_id: id, title: '', type_id: TYPE_SESSION, start_local: `${first.toISODate()}T${time}`, tz, duration_min: 50,
        repeat: { interval_weeks: weeks, until: null, exceptions: [] }, location: '', status: 'confirmed', note: '', series_id: null,
      });
    }
    let firstMet: DateTime | null = null;
    if (f.firstConsultation) {
      firstMet = at(monday, f.firstConsultation);
      push('appointment', {
        folder_id: id, title: '', type_id: TYPE_FIRST, start_local: `${monday.toISODate()}T${f.firstConsultation}`, tz, duration_min: 60,
        repeat: null, location: '', status: 'confirmed', note: '', series_id: null,
      });
    }
    // Written at the end of the latest session, or a few days before a first consultation (on the phone).
    const noted = past[0]?.plus({ minutes: 50 }) ?? firstMet?.minus({ days: 5 }).set({ hour: 11, minute: 0 }) ?? now.minus({ days: 7 });
    for (const n of f.notes) {
      push('sticky', { folder_id: id, page_id: null, text: n.text[locale], colour: n.colour, next_session: n.next, origin: 'therapist', state: 'stuck', peeled_at: null }, noted);
    }
    const page = (session: DateTime, template: Template, title: string, sections: Record<string, string>, ago: number | 'intake') => {
      const passages = (f.marks ?? []).filter((m) => m.ago === ago).map((m): Passage => {
        const words = m.words[locale];
        const start = (sections[m.section] ?? '').indexOf(words);
        if (start < 0) throw new Error(`demo: “${words}” is not on the page`);
        themesUsed.push(...m.themes[locale]);
        return { id: uuid(), section: m.section, start, end: start + words.length, quote: words, themes: m.themes[locale], created_at: session.plus({ minutes: 50 }).toUTC().toISO()! };
      });
      push(
        'page',
        { folder_id: id, date: session.toISODate()!, time: session.toFormat('HH:mm'), duration_min: 50, template, title, sections, process_note: '', import_provenance: null, passages },
        session.plus({ minutes: 50 }),
      );
    };
    for (const p of f.pages) {
      const session = past[p.ago - 1];
      if (session) page(session, p.template, p.title[locale], p.sections[locale], p.ago);
    }
    // The earlier sessions, back to the first: an intake page, then a short note for each.
    const oldestWritten = Math.max(0, ...f.pages.map((p) => p.ago));
    if (f.reason && f.slot && oldestWritten > 0) {
      for (let ago = oldestWritten + 1; ago <= past.length; ago++) {
        const session = past[ago - 1]!;
        if (ago === past.length) page(session, 'intake', '', { reason: f.reason[locale], plan: INTAKE_PLAN[f.slot[2]][locale] }, 'intake');
        else page(session, 'free', '', { body: BETWEEN[(i + ago) % BETWEEN.length]![locale] }, ago);
      }
    }
  }
  push('appointment', {
    folder_id: null, title: L('Supervision', 'Supervisão', 'Supervisión')[locale], type_id: null,
    start_local: `${monday.plus({ days: 2 }).toISODate()}T15:00`, tz, duration_min: 60, repeat: null, location: '', status: 'confirmed', note: '', series_id: null,
  });
  for (const weekday of [1, 2, 3, 4, 5] as const) {
    push('availability', { weekday, start: '09:00', end: '13:00' });
    push('availability', { weekday, start: '14:00', end: weekday === 2 ? '20:00' : '18:00' });
  }
  push('appointment_type', { id: TYPE_FIRST, name: L('First consultation', 'Primeira consulta', 'Primera consulta')[locale], duration_min: 60, colour: 'coral', for_new_patients: true, archived: false });
  push('appointment_type', { id: TYPE_SESSION, name: L('Session', 'Sessão', 'Sesión')[locale], duration_min: 50, colour: 'teal', for_new_patients: false, archived: false });

  await setSetting(store, KNOWN_THEMES_SETTING, uniqueThemes(themesUsed));
  const saved = await store.putMany(drafts.map(({ kind, draft }) => ({ kind, draft })) as never);
  // Back-date notes and pages to when they would have been written, oldest first, so the
  // latest sessions are also the most recently edited pages.
  const written = drafts
    .map((d, i) => ({ kind: d.kind, written: d.written, record: saved[i]! }))
    .filter((d): d is { kind: SeedKind; written: DateTime; record: Base } => !!d.written)
    .sort((a, b) => a.written.toMillis() - b.written.toMillis());
  await store.merge(
    written.map(({ kind, written: when, record }) => ({
      kind,
      record: { ...(record as Entity<SeedKind>), created_at: when.toUTC().toISO()!, updated_at_hlc: store.hlc.tick() },
    })),
  );
}
