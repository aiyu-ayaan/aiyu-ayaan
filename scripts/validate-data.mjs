// Checks every data/*.json file against data/schema/<name>.schema.json.
// No dependencies: this implements the small part of JSON Schema the schemas
// use (type, properties, required, additionalProperties, items, enum, pattern,
// oneOf, and the min/max length and item counts).
//
//   node scripts/validate-data.mjs

import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const SCHEMA_DIR = join(DATA_DIR, 'schema');

const typeOf = (v) => (Array.isArray(v) ? 'array' : v === null ? 'null' : Number.isInteger(v) ? 'integer' : typeof v);

function check(value, schema, path, errors) {
  const type = typeOf(value);
  if (schema.type && !(schema.type === type || (schema.type === 'number' && type === 'integer'))) {
    errors.push(`${path}: expected ${schema.type}, found ${type}`);
    return;
  }
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path}: "${value}" is not one of ${schema.enum.join(', ')}`);
  }
  if (type === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${path}: must not be empty`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push(`${path}: "${value}" is longer than ${schema.maxLength} characters`);
    }
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      errors.push(`${path}: "${value}" does not match ${schema.pattern}`);
    }
  }
  if (type === 'array') {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path}: needs at least ${schema.minItems} item(s)`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${path}: has more than ${schema.maxItems} items`);
    if (schema.items) value.forEach((item, i) => check(item, schema.items, `${path}[${i}]`, errors));
  }
  if (type === 'object') {
    for (const key of schema.required || []) {
      if (!(key in value)) errors.push(`${path}: missing "${key}"`);
    }
    for (const [key, item] of Object.entries(value)) {
      const sub = schema.properties?.[key];
      if (sub) check(item, sub, `${path}.${key}`, errors);
      else if (schema.additionalProperties === false) errors.push(`${path}: unknown key "${key}"`);
    }
    if (schema.oneOf) {
      const matches = schema.oneOf.filter((option) => (option.required || []).every((key) => key in value)).length;
      if (matches !== 1) {
        errors.push(`${path}: needs exactly one of ${schema.oneOf.map((o) => o.required.join('+')).join(' or ')}`);
      }
    }
  }
}

// Returns a list of problems; empty means every file is valid.
export async function validateData() {
  const errors = [];
  const schemas = (await readdir(SCHEMA_DIR)).filter((f) => f.endsWith('.schema.json'));
  const dataFiles = (await readdir(DATA_DIR)).filter((f) => f.endsWith('.json'));
  for (const file of dataFiles) {
    if (!schemas.includes(file.replace(/\.json$/, '.schema.json'))) errors.push(`data/${file}: no schema in data/schema/`);
  }
  for (const schemaFile of schemas) {
    const name = schemaFile.replace(/\.schema\.json$/, '');
    let value;
    try {
      value = JSON.parse(await readFile(join(DATA_DIR, `${name}.json`), 'utf8'));
    } catch (error) {
      errors.push(`data/${name}.json: ${error.code === 'ENOENT' ? 'file is missing' : `not valid JSON (${error.message})`}`);
      continue;
    }
    const schema = JSON.parse(await readFile(join(SCHEMA_DIR, schemaFile), 'utf8'));
    check(value, schema, `data/${name}.json`, errors);
  }
  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const errors = await validateData();
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
  }
  console.log('data/ is valid');
}
