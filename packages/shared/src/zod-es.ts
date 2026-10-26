import { z, type ZodErrorMap } from 'zod';

/** Mensajes de validación en español para los casos que los esquemas no personalizan. */
export const zodErrorMapEs: ZodErrorMap = (issue, ctx) => {
  switch (issue.code) {
    case 'invalid_type':
      if (issue.received === 'undefined' || issue.received === 'null')
        return { message: 'Este campo es obligatorio.' };
      return { message: 'Tipo de dato no válido.' };
    case 'too_small':
      if (issue.type === 'string') {
        return {
          message:
            issue.minimum === 1
              ? 'Este campo es obligatorio.'
              : `Mínimo ${issue.minimum} caracteres.`,
        };
      }
      if (issue.type === 'array') return { message: `Seleccione al menos ${issue.minimum}.` };
      return { message: `Debe ser mayor o igual a ${issue.minimum}.` };
    case 'too_big':
      if (issue.type === 'string') return { message: `Máximo ${issue.maximum} caracteres.` };
      if (issue.type === 'array') return { message: `Máximo ${issue.maximum} elementos.` };
      return { message: `Debe ser menor o igual a ${issue.maximum}.` };
    case 'invalid_enum_value':
      return { message: 'Opción no válida.' };
    case 'invalid_string':
      if (issue.validation === 'email') return { message: 'Correo no válido.' };
      if (issue.validation === 'url') return { message: 'URL no válida.' };
      if (issue.validation === 'uuid') return { message: 'Identificador no válido.' };
      return { message: 'Formato no válido.' };
    case 'invalid_date':
      return { message: 'Fecha no válida.' };
    case 'unrecognized_keys':
      return { message: 'Hay campos no permitidos.' };
    default:
      return { message: ctx.defaultError };
  }
};

z.setErrorMap(zodErrorMapEs);
