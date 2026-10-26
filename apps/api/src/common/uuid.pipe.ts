import { Injectable, PipeTransform } from '@nestjs/common';
import { notFound } from './errors';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `@Param('id', UuidPipe)`: un id mal formado responde 404, igual que uno inexistente. */
@Injectable()
export class UuidPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!UUID_RE.test(value)) throw notFound();
    return value;
  }
}
