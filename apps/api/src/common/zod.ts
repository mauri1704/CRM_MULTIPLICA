import {
  ArgumentMetadata,
  Injectable,
  PipeTransform,
  UsePipes,
  applyDecorators,
} from '@nestjs/common';
import { ApiBody, ApiQuery } from '@nestjs/swagger';
import type { ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { validationError } from './errors';
import { zodDetails } from './http-exception.filter';

@Injectable()
class ZodPipe implements PipeTransform {
  constructor(
    private readonly schema: ZodTypeAny,
    private readonly target: 'body' | 'query',
  ) {}

  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    if (metadata.type !== this.target || metadata.data) return value;
    const parsed = this.schema.safeParse(value ?? {});
    if (!parsed.success) throw validationError(zodDetails(parsed.error));
    return parsed.data;
  }
}

function jsonSchema(schema: ZodTypeAny): Record<string, unknown> {
  const { $schema: _ignored, ...rest } = zodToJsonSchema(schema, { target: 'openApi3' }) as Record<
    string,
    unknown
  >;
  return rest;
}

/** Valida el cuerpo completo (`@Body() body`) con Zod y lo documenta en OpenAPI. */
export const ZodBody = (schema: ZodTypeAny) =>
  applyDecorators(ApiBody({ schema: jsonSchema(schema) }), UsePipes(new ZodPipe(schema, 'body')));

/** Valida la query completa (`@Query() query`) con Zod. */
export const ZodQuery = (schema: ZodTypeAny) =>
  applyDecorators(
    ApiQuery({
      name: 'query',
      required: false,
      schema: jsonSchema(schema),
      style: 'form',
      explode: true,
    }),
    UsePipes(new ZodPipe(schema, 'query')),
  );
