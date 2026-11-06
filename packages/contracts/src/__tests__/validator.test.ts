import { describe, expect, it } from 'vitest';
import { SchemaValidator } from '../validator.js';
import {
  EXAMPLE_USER_SCHEMA_ID,
  exampleUserSchema,
  type ExampleUser,
} from '../schemas/example-user.js';

function newValidator(): SchemaValidator {
  const v = new SchemaValidator();
  v.register(EXAMPLE_USER_SCHEMA_ID, exampleUserSchema);
  return v;
}

describe('SchemaValidator', () => {
  it('accepts a valid document', () => {
    const v = newValidator();
    const result = v.validate<ExampleUser>(EXAMPLE_USER_SCHEMA_ID, { id: 'u1', name: 'Alice' });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value.name).toBe('Alice');
    }
  });

  it('rejects an invalid document with structured issues', () => {
    const v = newValidator();
    const result = v.validate(EXAMPLE_USER_SCHEMA_ID, { id: 'u1' });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.issues.some((i) => i.keyword === 'required')).toBe(true);
      for (const issue of result.issues) {
        expect(typeof issue.instancePath).toBe('string');
        expect(typeof issue.message).toBe('string');
      }
    }
  });

  it('rejects unknown properties (additionalProperties: false)', () => {
    const v = newValidator();
    const result = v.validate(EXAMPLE_USER_SCHEMA_ID, { id: 'u1', name: 'Alice', extra: true });
    expect(result.valid).toBe(false);
  });

  it('throws when validating an unregistered schema', () => {
    const v = newValidator();
    expect(() => v.validate('missing/v1', {})).toThrow(/not registered/);
  });

  it('throws on duplicate registration', () => {
    const v = newValidator();
    expect(() => v.register(EXAMPLE_USER_SCHEMA_ID, exampleUserSchema)).toThrow(
      /already registered/,
    );
  });
});
