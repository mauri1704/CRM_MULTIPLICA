import {
  ACTIVITY_TYPE_LABELS,
  ACTIVITY_TYPES,
  type ActivityTarget,
  type ActivityType,
} from '@crm/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarClock,
  Mail,
  MessageSquareText,
  Phone,
  Trash2,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { FormMessage } from '@/components/ui/form-message';
import { Input, Select, Textarea } from '@/components/ui/input';
import { EmptyState, Spinner } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { ApiError, api, errorMessage } from '@/lib/api';
import { fromLocalInput, toLocalInput } from '@/lib/datetime';
import { formatDateTime } from '@/lib/format';
import type { ActivityItem } from '@/lib/types';

const ICONS: Record<ActivityType, LucideIcon> = {
  CALL: Phone,
  MEETING: Users,
  EMAIL: Mail,
  NOTE: MessageSquareText,
};

/** Línea de tiempo de interacciones registradas a mano (D-23): no son tareas ni automatizaciones. */
export function ActivitiesPanel({ type, id }: { type: ActivityTarget; id: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const key = ['activities', type, id];
  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => api.get<ActivityItem[]>(`/activities/${type.toLowerCase()}/${id}`),
  });
  const [kind, setKind] = useState<ActivityType>('CALL');
  const [subject, setSubject] = useState('');
  const [notes, setNotes] = useState('');
  const [when, setWhen] = useState(() => toLocalInput(new Date()));
  const [details, setDetails] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    setError(null);
    setDetails({});
    try {
      await api.post(`/activities/${type.toLowerCase()}/${id}`, {
        type: kind,
        subject,
        notes,
        occurredAt: fromLocalInput(when) ?? '',
      });
      setSubject('');
      setNotes('');
      setWhen(toLocalInput(new Date()));
      await qc.invalidateQueries({ queryKey: key });
      toast.success('Actividad registrada.');
    } catch (e) {
      if (e instanceof ApiError) setDetails(e.details);
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <fieldset className="space-y-3 rounded-md border border-border p-3">
        <legend className="px-1 text-sm font-semibold">Registrar actividad</legend>
        <FormMessage error={error} />
        <div className="grid gap-3 sm:grid-cols-[9rem_1fr]">
          <Field label="Tipo">
            <Select value={kind} onChange={(e) => setKind(e.target.value as ActivityType)}>
              {ACTIVITY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {ACTIVITY_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Asunto" error={details.subject} required>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
          </Field>
        </div>
        <Field label="Fecha y hora" error={details.occurredAt}>
          <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
        </Field>
        <Field label="Detalle" error={details.notes}>
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <div className="flex justify-end">
          <Button size="sm" loading={busy} disabled={subject.trim().length < 2} onClick={save}>
            Registrar
          </Button>
        </div>
      </fieldset>
      {isLoading ? (
        <Spinner />
      ) : !data?.length ? (
        <EmptyState icon={CalendarClock} title="Sin actividades registradas" />
      ) : (
        <ol className="space-y-3" aria-label="Actividades">
          {data.map((a) => {
            const Icon = ICONS[a.type];
            return (
              <li key={a.id} className="flex gap-3">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1 text-sm">
                  <p>
                    <span className="font-medium">{ACTIVITY_TYPE_LABELS[a.type]}:</span> {a.subject}
                  </p>
                  {a.notes && <p className="whitespace-pre-line text-fg-muted">{a.notes}</p>}
                  <p className="text-xs text-fg-muted">
                    {formatDateTime(a.occurredAt)} · {a.author.name}
                  </p>
                </div>
                {a.mine && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Eliminar actividad ${a.subject}`}
                    onClick={async () => {
                      try {
                        await api.delete(`/activities/${a.id}`);
                        await qc.invalidateQueries({ queryKey: key });
                      } catch (e) {
                        toast.error(errorMessage(e));
                      }
                    }}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </Button>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
