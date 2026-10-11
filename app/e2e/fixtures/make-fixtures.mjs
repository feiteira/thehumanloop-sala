// Generates the fictional import fixtures used by the end-to-end tests.
// Every person and note here is invented. Run: node e2e/fixtures/make-fixtures.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { strToU8, zipSync } from 'fflate';

const root = join(import.meta.dirname, 'practice');
const dir = (...p) => {
  const d = join(root, ...p);
  mkdirSync(d, { recursive: true });
  return d;
};

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
function docx(paragraphs) {
  const body = paragraphs
    .map(([style, text]) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`)
    .join('');
  return zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    'word/document.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`),
  });
}

function odt(paragraphs) {
  const body = paragraphs.map((p) => `<text:p>${esc(p)}</text:p>`).join('');
  return zipSync({
    mimetype: [strToU8('application/vnd.oasis.opendocument.text'), { level: 0 }],
    'content.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:text>${body}</office:text></office:body></office:document-content>`),
  });
}

/** A one-page PDF with a real text layer. */
function pdf(lines) {
  const content = `BT /F1 14 Tf 72 760 Td 18 TL ${lines.map((l) => `(${l.replace(/[()\\]/g, '\\$&')}) '`).join(' ')} ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const ana = dir('Pacientes', 'Ana Silva');
writeFileSync(join(ana, '2024-03-12 sessão.docx'), docx([['Heading1', 'Sessão 3'], ['', 'A Ana falou sobre o regresso ao trabalho.'], ['', 'Combinámos um diário de humor para a próxima semana.']]));
writeFileSync(join(ana, 'notas 19.03.2024.odt'), odt(['Sessão 4', 'O diário de humor mostra melhoria ao fim de semana.']));
writeFileSync(join(ana, 'relatório.pdf'), pdf(['Relatorio de encaminhamento', 'Data: 5 de fevereiro de 2024', 'Paciente encaminhada pelo medico de familia.']));

const rui = dir('Pacientes', 'Rui Marques');
writeFileSync(join(rui, 'primeira consulta.txt'), 'Primeira consulta — 2 de abril de 2024\n\nMotivo: ansiedade antes dos exames.\n');
execFileSync('convert', ['-size', '1400x500', 'xc:white', '-font', 'DejaVu-Sans', '-pointsize', '40', '-fill', 'black',
  '-annotate', '+60+120', 'Sessao de 9 de abril de 2024', '-annotate', '+60+220', 'Plano: exposicao gradual na biblioteca.', '-annotate', '+60+320', 'Rever na proxima semana.',
  join(rui, 'digitalizacao.png')]);
writeFileSync(join(rui, 'antigo.doc'), 'not really a Word 97 file');

writeFileSync(join(root, 'pacientes.csv'), '﻿Nome;Email;Telemóvel;Notas\nBeatriz Nunes;beatriz@example.org;910000001;Encaminhada pela clínica\nSilva, Ana;ana@example.org;910000002;\n');
writeFileSync(join(root, 'calendario.ics'), [
  'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Fixture//EN',
  'BEGIN:VEVENT', 'UID:fx-1', 'SUMMARY:Ana Silva', 'DTSTART;TZID=Europe/Lisbon:20260929T100000', 'DTEND;TZID=Europe/Lisbon:20260929T105000', 'RRULE:FREQ=WEEKLY', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:fx-2', 'SUMMARY:Reunião de equipa', 'DTSTART;TZID=Europe/Lisbon:20260930T170000', 'DTEND;TZID=Europe/Lisbon:20260930T180000', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:fx-3', 'SUMMARY:Rui Marques', 'DTSTART;TZID=Europe/Lisbon:20261001T120000', 'DTEND;TZID=Europe/Lisbon:20261001T125000', 'RRULE:FREQ=WEEKLY;INTERVAL=2', 'END:VEVENT',
  'END:VCALENDAR', '',
].join('\r\n'));
console.log('fixtures written to', root);
