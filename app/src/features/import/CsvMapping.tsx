import React from 'react';
import { type CsvField, type CsvTable, setColumnField } from '../../core/import/csv';
import { useI18n } from '../../ui/i18n';
import { Button, Card, Col, Row, Segmented, T } from '../../ui/primitives';
import { space } from '../../ui/theme';

const FIELDS: CsvField[] = ['ignore', 'label', 'email', 'phone', 'start', 'notes', 'tags'];

/** Which column of a patient list is which. Several columns can make the name (first name + surname). */
export function CsvMapping({ table, mapping, onChange, onBack, onNext }: { table: CsvTable; mapping: CsvField[]; onChange: (m: CsvField[]) => void; onBack: () => void; onNext: () => void }) {
  const { t } = useI18n();
  return (
    <Card style={{ gap: space.md }}>
      <Col gap={space.xs}>
        <T variant="heading">{t('import.csvMapping')}</T>
        <T variant="small" tone="secondary">{t('import.csvMappingHint')}</T>
      </Col>
      {table.header.map((h, i) => (
        <Row key={i} wrap>
          <Col gap={0} style={{ width: 220 }}>
            <T variant="label">{h || `${t('import.csvColumn')} ${i + 1}`}</T>
            <T variant="tiny" tone="muted" numberOfLines={1}>{table.rows[0]?.[i] ?? ''}</T>
          </Col>
          <Segmented<CsvField>
            label={h || `${t('import.csvColumn')} ${i + 1}`}
            value={mapping[i] ?? 'ignore'}
            onChange={(f) => onChange(setColumnField(mapping, i, f))}
            options={FIELDS.map((f) => ({ value: f, label: t(`import.csvField.${f}`) }))}
          />
        </Row>
      ))}
      <Row style={{ justifyContent: 'space-between' }}>
        <Button variant="ghost" icon="chevronLeft" label={t('common.back')} onPress={onBack} />
        <Button variant="primary" label={t('common.next')} disabled={!mapping.includes('label')} onPress={onNext} testID="csv-next" />
      </Row>
    </Card>
  );
}
