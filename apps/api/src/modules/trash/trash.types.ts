import type { TrashableEntity } from '@crm/shared';
import type { Actor } from '../../common/auth.types';

export interface TrashSubject {
  id: string;
  displayName: string;
  code?: string | null;
  ownerId?: string | null;
  relations?: Record<string, unknown>;
}

/**
 * Lo que cada módulo implementa para que sus registros funcionen con la papelera.
 * El módulo marca `deleted_at` en su tabla y llama a `TrashService.add`; la papelera llama a
 * estos métodos para restaurar o eliminar definitivamente.
 */
export interface TrashHandler {
  entityType: TrashableEntity;
  /** Conflictos que impiden restaurar (vacío = se puede). Mensajes para el usuario. */
  restoreConflicts(entityId: string): Promise<string[]>;
  restore(entityId: string, actor: Actor): Promise<void>;
  /** Dependencias vivas que impiden la eliminación definitiva (vacío = se puede). */
  purgeBlockers(entityId: string): Promise<string[]>;
  purge(entityId: string): Promise<void>;
}
