import { useState } from 'react';
import { Field, Input, Select } from './ui';

export interface JsonSchemaProperty {
  type?: string;
  title?: string;
  description?: string;
  enum?: string[];
}

export interface ObjectSchema {
  type: 'object';
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
}

export interface SchemaFormProps {
  schema: ObjectSchema;
  value?: Record<string, unknown>;
  onChange?: (value: Record<string, unknown>) => void;
  readOnly?: boolean;
}

/** Schema UI（25 设计 §10.1 L4 Interactive View）：从 JSON Schema 确定性渲染表单。 */
export default function SchemaForm({ schema, value, onChange, readOnly }: SchemaFormProps) {
  const [draft, setDraft] = useState<Record<string, unknown>>(value ?? {});
  const properties = schema.properties ?? {};
  const required = schema.required ?? [];

  function update(key: string, v: unknown) {
    const next = { ...draft, [key]: v };
    setDraft(next);
    onChange?.(next);
  }

  return (
    <div className="wb-col">
      {Object.entries(properties).map(([key, prop]) => {
        const isRequired = required.includes(key);
        const label = prop.title ?? key;
        // 布尔字段：Field 本身是 <label>，内部不能再嵌 <label>，故单独渲染
        if (!prop.enum && prop.type === 'boolean') {
          return (
            <div key={key} className="wb-field">
              <span className="wb-field__label">
                {label}
                {isRequired ? <span style={{ color: 'var(--wb-danger)' }}> *</span> : null}
              </span>
              <label className="wb-check">
                <input
                  type="checkbox"
                  checked={Boolean(draft[key])}
                  disabled={readOnly}
                  onChange={(e) => update(key, e.target.checked)}
                />
                <span>{label}</span>
              </label>
              {prop.description ? <span className="wb-field__hint">{prop.description}</span> : null}
            </div>
          );
        }
        return (
          <Field key={key} label={label} required={isRequired} hint={prop.description ?? undefined}>
            {prop.enum ? (
              <Select
                value={String(draft[key] ?? '')}
                disabled={readOnly}
                onChange={(e) => update(key, e.target.value)}
              >
                <option value="" />
                {prop.enum.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </Select>
            ) : prop.type === 'number' || prop.type === 'integer' ? (
              <Input
                type="number"
                value={draft[key] === undefined ? '' : String(draft[key])}
                disabled={readOnly}
                onChange={(e) => update(key, Number(e.target.value))}
              />
            ) : (
              <Input
                type="text"
                value={draft[key] === undefined ? '' : String(draft[key])}
                disabled={readOnly}
                onChange={(e) => update(key, e.target.value)}
              />
            )}
          </Field>
        );
      })}
    </div>
  );
}
