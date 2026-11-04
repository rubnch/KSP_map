import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import Ajv from 'ajv';
import schema from '../../data/schema/system.schema.json';

const packsDir = join(__dirname, '../../data/packs');
const packFiles = readdirSync(packsDir).filter((f) => f.endsWith('.json'));

describe('system pack schema', () => {
  const validate = new Ajv({ allErrors: true }).compile(schema);

  it('compiles', () => {
    expect(typeof validate).toBe('function');
  });

  it.each(packFiles)('%s is valid', (file: string) => {
    const pack = JSON.parse(readFileSync(join(packsDir, file), 'utf8'));
    const ok = validate(pack);
    expect(validate.errors ?? []).toEqual([]);
    expect(ok).toBe(true);
  });
});
