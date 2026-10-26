import { describe, expect, it } from 'vitest';
import { validateCustomFields, type CustomFieldDefinitionLike } from '../src';

const def = (
  d: Partial<CustomFieldDefinitionLike> & Pick<CustomFieldDefinitionLike, 'key' | 'type'>,
) => ({
  label: d.key,
  required: false,
  active: true,
  options: [],
  ...d,
});

describe('validateCustomFields', () => {
  const defs = [
    def({ key: 'texto', type: 'TEXT' }),
    def({ key: 'monto', type: 'MONEY' }),
    def({ key: 'activo', type: 'BOOLEAN' }),
    def({ key: 'tipo', type: 'SELECT', options: [{ value: 'a', label: 'A' }] }),
    def({
      key: 'tags',
      type: 'MULTISELECT',
      options: [
        { value: 'x', label: 'X' },
        { value: 'y', label: 'Y' },
      ],
    }),
    def({ key: 'web', type: 'URL' }),
    def({ key: 'mail', type: 'EMAIL' }),
    def({ key: 'obligatorio', type: 'NUMBER', required: true }),
    def({ key: 'viejo', type: 'TEXT', active: false }),
  ];

  it('normaliza valores válidos y descarta claves desconocidas', () => {
    const r = validateCustomFields(
      defs,
      {
        texto: '  hola ',
        monto: '12,345678',
        activo: 'true',
        tipo: 'a',
        tags: ['x', 'x', 'y'],
        web: 'https://multiplica.pe',
        mail: 'A@B.PE',
        obligatorio: 3,
        intruso: 1,
      },
      { viejo: 'se conserva' },
    );
    expect(r).toEqual({
      ok: true,
      values: {
        texto: 'hola',
        monto: 12.3457,
        activo: true,
        tipo: 'a',
        tags: ['x', 'y'],
        web: 'https://multiplica.pe',
        mail: 'a@b.pe',
        obligatorio: 3,
        viejo: 'se conserva',
      },
    });
  });

  it('informa cada error por campo', () => {
    const r = validateCustomFields(defs, {
      tipo: 'z',
      tags: ['q'],
      web: 'no-url',
      mail: 'x',
      monto: 'abc',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(Object.keys(r.errors).sort()).toEqual([
        'mail',
        'monto',
        'obligatorio',
        'tags',
        'tipo',
        'web',
      ]);
      expect(r.errors.obligatorio).toBe('obligatorio es obligatorio.');
    }
  });
});
