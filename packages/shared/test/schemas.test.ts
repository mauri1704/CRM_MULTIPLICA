import { describe, expect, it } from 'vitest';
import { formatCode, loginInput, password, pipelineInput } from '../src';

describe('esquemas', () => {
  it('normaliza el correo y devuelve mensajes en español', () => {
    expect(loginInput.parse({ email: ' Ana@Multiplica.PE ', password: 'x' }).email).toBe(
      'ana@multiplica.pe',
    );
    const r = loginInput.safeParse({ email: 'no-es-correo' });
    expect(r.success).toBe(false);
    if (!r.success) {
      const messages = r.error.issues.map((i) => i.message);
      expect(messages).toContain('Ingrese un correo válido.');
      expect(messages).toContain('Este campo es obligatorio.');
    }
  });

  it('aplica la política de contraseñas', () => {
    expect(password.safeParse('corta1').success).toBe(false);
    expect(password.safeParse('solamenteletras').success).toBe(false);
    expect(password.safeParse('Segura12345').success).toBe(true);
  });

  it('valida la estructura de un pipeline de prospectos', () => {
    const base = { entityType: 'LEAD', name: 'Prospección' };
    const ok = pipelineInput.safeParse({
      ...base,
      stages: [
        { name: 'Nuevo', color: '#000000', kind: 'OPEN' },
        { name: 'Convertido', color: '#000000', kind: 'CONVERTED' },
        { name: 'Descartado', color: '#000000', kind: 'LOST' },
      ],
    });
    expect(ok.success).toBe(true);
    const bad = pipelineInput.safeParse({
      ...base,
      stages: [
        { name: 'Nuevo', color: '#000000', kind: 'OPEN' },
        { name: 'nuevo', color: '#000000', kind: 'WON' },
      ],
    });
    expect(bad.success).toBe(false);
  });

  it('formatea códigos correlativos', () => {
    expect(formatCode('LEAD', 1)).toBe('PRO-000001');
    expect(formatCode('DEAL', 1234567)).toBe('NEG-1234567');
  });
});
