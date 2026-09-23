// Turns a tool's JSON Schema (from MCP tools/list) into form fields, and form
// values back into tool arguments. This is what lets a new tool appear in the
// console with zero UI work (ADR-003). Pure functions, no React.
import type { JsonSchema } from './mcp';

export type FieldKind = 'string' | 'number' | 'integer' | 'boolean' | 'enum' | 'unsupported';

export interface Field {
  name: string;
  kind: FieldKind;
  required: boolean;
  description?: string;
  /** Allowed values, for kind 'enum'. */
  options?: string[];
}

/** What the form holds: text for inputs and selects, booleans for checkboxes. */
export type FormValues = Record<string, string | boolean>;

function primaryType(schema: JsonSchema): string | undefined {
  if (Array.isArray(schema.type)) return schema.type.find((t) => t !== 'null');
  return schema.type;
}

function kindOf(schema: JsonSchema): FieldKind {
  if (Array.isArray(schema.enum) && schema.enum.every((v) => typeof v === 'string')) return 'enum';
  switch (primaryType(schema)) {
    case 'string':
      return 'string';
    case 'number':
      return 'number';
    case 'integer':
      return 'integer';
    case 'boolean':
      return 'boolean';
    default:
      return 'unsupported';
  }
}

export function schemaToFields(schema: JsonSchema | undefined): Field[] {
  const properties = schema?.properties ?? {};
  const required = new Set(schema?.required ?? []);
  return Object.entries(properties).map(([name, prop]) => {
    const kind = kindOf(prop);
    return {
      name,
      kind,
      required: required.has(name),
      description: prop.description,
      ...(kind === 'enum' ? { options: prop.enum as string[] } : {}),
    };
  });
}

export function initialValues(fields: Field[]): FormValues {
  return Object.fromEntries(fields.map((f) => [f.name, f.kind === 'boolean' ? false : '']));
}

export type BuildResult =
  | { ok: true; args: Record<string, unknown> }
  | { ok: false; errors: Record<string, string> };

/**
 * Form values -> tool arguments. Empty optional fields are left out so the
 * tool sees them as absent; numbers are parsed; problems come back per field.
 */
export function buildArgs(fields: Field[], values: FormValues): BuildResult {
  const args: Record<string, unknown> = {};
  const errors: Record<string, string> = {};

  for (const field of fields) {
    const value = values[field.name];

    if (field.kind === 'boolean') {
      if (value === true || field.required) args[field.name] = value === true;
      continue;
    }

    const text = typeof value === 'string' ? value.trim() : '';
    if (text === '') {
      if (field.required) errors[field.name] = 'Required.';
      continue;
    }

    switch (field.kind) {
      case 'number':
      case 'integer': {
        const n = Number(text);
        if (!Number.isFinite(n)) errors[field.name] = 'Enter a number.';
        else if (field.kind === 'integer' && !Number.isInteger(n)) errors[field.name] = 'Enter a whole number.';
        else args[field.name] = n;
        break;
      }
      case 'enum':
        if (!field.options?.includes(text)) errors[field.name] = 'Choose one of the listed values.';
        else args[field.name] = text;
        break;
      case 'unsupported':
        errors[field.name] = "This parameter's type isn't supported by the console yet.";
        break;
      default:
        args[field.name] = text;
    }
  }

  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, args };
}
