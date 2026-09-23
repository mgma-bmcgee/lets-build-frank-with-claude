import { describe, expect, it } from 'vitest';
import { buildArgs, initialValues, schemaToFields } from '../src/schemaForm';

// The shape zod emits for a strict object, as Frank's tools/list sends it.
const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'limit', 'kind'],
  properties: {
    name: { type: 'string', description: 'Resource name' },
    limit: { type: 'integer', description: 'How many' },
    ratio: { type: 'number' },
    verbose: { type: 'boolean', description: 'More detail' },
    kind: { type: 'string', enum: ['app', 'job'] },
    tags: { type: 'array', items: { type: 'string' } },
    nickname: { type: ['string', 'null'] },
  },
};

describe('schemaToFields', () => {
  const fields = schemaToFields(schema);
  const byName = Object.fromEntries(fields.map((f) => [f.name, f]));

  it('maps each JSON Schema type to a field kind', () => {
    expect(byName.name.kind).toBe('string');
    expect(byName.limit.kind).toBe('integer');
    expect(byName.ratio.kind).toBe('number');
    expect(byName.verbose.kind).toBe('boolean');
    expect(byName.kind.kind).toBe('enum');
    expect(byName.kind.options).toEqual(['app', 'job']);
    expect(byName.tags.kind).toBe('unsupported');
    expect(byName.nickname.kind).toBe('string');
  });

  it('honours required and carries descriptions', () => {
    expect(byName.name).toMatchObject({ required: true, description: 'Resource name' });
    expect(byName.ratio.required).toBe(false);
  });

  it('gives an empty form for a tool with no parameters (get_status)', () => {
    expect(schemaToFields({ type: 'object', properties: {}, additionalProperties: false })).toEqual([]);
    expect(schemaToFields(undefined)).toEqual([]);
  });
});

describe('buildArgs', () => {
  const fields = schemaToFields(schema).filter((f) => f.kind !== 'unsupported');

  it('parses numbers and leaves out empty optional fields', () => {
    const values = { ...initialValues(fields), name: ' frank ', limit: '5', kind: 'app' };
    expect(buildArgs(fields, values)).toEqual({ ok: true, args: { name: 'frank', limit: 5, kind: 'app' } });
  });

  it('includes a checked optional boolean', () => {
    const values = { ...initialValues(fields), name: 'f', limit: '1', kind: 'job', verbose: true };
    expect(buildArgs(fields, values)).toMatchObject({ ok: true, args: { verbose: true } });
  });

  it('reports missing required fields and bad numbers per field', () => {
    const values = { ...initialValues(fields), limit: '2.5', ratio: 'abc' };
    const result = buildArgs(fields, values);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual({
        name: 'Required.',
        limit: 'Enter a whole number.',
        ratio: 'Enter a number.',
        kind: 'Required.',
      });
    }
  });

  it('rejects a value outside an enum', () => {
    const values = { ...initialValues(fields), name: 'f', limit: '1', kind: 'vm' };
    expect(buildArgs(fields, values)).toMatchObject({ ok: false, errors: { kind: expect.any(String) } });
  });

  it('builds {} for a tool with no parameters', () => {
    expect(buildArgs([], {})).toEqual({ ok: true, args: {} });
  });
});
