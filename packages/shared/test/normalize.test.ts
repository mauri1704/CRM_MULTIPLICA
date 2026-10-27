import { describe, expect, it } from 'vitest';
import { isValidRuc, normalizeIdentifier, normalizePhone, normalizeText } from '../src';

describe('normalización', () => {
  it('normaliza texto, teléfonos e identificadores', () => {
    expect(normalizeText('  Ñandú  Comercial, S.A.C. ')).toBe('nandu comercial s.a.c.');
    expect(normalizePhone('987 654 321')).toBe('51987654321');
    expect(normalizePhone('+51 (1) 555-1234')).toBe('5115551234');
    expect(normalizeIdentifier('2010-0070-970')).toBe('20100070970');
  });

  it('valida el dígito verificador del RUC', () => {
    expect(isValidRuc('20131312955')).toBe(true); // SUNAT
    expect(isValidRuc('20100047218')).toBe(true); // BCP
    expect(isValidRuc('20131312956')).toBe(false);
    expect(isValidRuc('30131312955')).toBe(false);
    expect(isValidRuc('2013131295')).toBe(false);
  });
});
