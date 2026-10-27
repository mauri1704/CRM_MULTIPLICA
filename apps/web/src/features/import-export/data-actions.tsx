import type { ImportEntity, PermissionAction, PermissionModule } from '@crm/shared';
import { Download, Upload } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth';
import { ExportDialog } from './export-dialog';
import { ImportWizard } from './import-wizard';

/** Botones Importar / Exportar de una lista, según permisos. */
export function DataActions({
  entity,
  module,
  filters,
  importAction = 'import',
  updateAction = 'edit',
}: {
  entity: ImportEntity;
  module: PermissionModule;
  filters: Record<string, string | number | boolean | undefined | null>;
  importAction?: PermissionAction;
  updateAction?: PermissionAction;
}) {
  const { can } = useAuth();
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const canImport =
    can(module, 'import') && (importAction === 'import' || can(module, importAction));
  return (
    <>
      {canImport && (
        <Button variant="secondary" onClick={() => setImporting(true)}>
          <Upload className="h-4 w-4" aria-hidden />
          Importar
        </Button>
      )}
      {can(module, 'export') && (
        <Button variant="secondary" onClick={() => setExporting(true)}>
          <Download className="h-4 w-4" aria-hidden />
          Exportar
        </Button>
      )}
      {canImport && (
        <ImportWizard
          entity={entity}
          open={importing}
          onOpenChange={setImporting}
          canUpdate={can(module, updateAction)}
        />
      )}
      <ExportDialog
        entity={entity}
        open={exporting}
        onOpenChange={setExporting}
        filters={filters}
      />
    </>
  );
}
