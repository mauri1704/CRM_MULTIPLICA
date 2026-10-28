import type { DateSelectArg, EventContentArg, EventDropArg, EventInput } from '@fullcalendar/core';
import esLocale from '@fullcalendar/core/locales/es';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin, { type EventResizeDoneArg } from '@fullcalendar/interaction';
import FullCalendar from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/timegrid';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { useState } from 'react';
import { useToast } from '@/components/ui/toast';
import { STAGE_KIND } from '@/features/sales/stage-kind';
import { api, errorMessage } from '@/lib/api';
import type { Task } from '@/lib/types';

const HALF_HOUR = 30 * 60_000;
/**
 * El calendario trabaja en «UTC» con la hora de pared de Lima (UTC−5, sin horario de verano,
 * D-21), para que coincida con el resto de la aplicación sin importar la zona del navegador.
 */
const LIMA_OFFSET = 5 * 3600_000;
const toWall = (iso: string | Date) => new Date(new Date(iso).getTime() - LIMA_OFFSET);
const fromWall = (d: Date) => new Date(d.getTime() + LIMA_OFFSET);

/**
 * Calendario de tareas (mes / semana / día). Arrastrar o estirar una tarea cambia sus fechas
 * (T-05); solo se puede con permiso para editarla.
 */
export function TaskCalendar({
  filters,
  onOpen,
  onCreate,
}: {
  filters: Record<string, string | boolean | undefined>;
  onOpen: (id: string) => void;
  onCreate?: (start: string, end: string) => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const { data } = useQuery({
    queryKey: ['tasks', 'calendar', filters, range],
    queryFn: () => api.get<Task[]>('/tasks/calendar', { ...filters, ...range }),
    enabled: !!range,
    placeholderData: (prev) => prev,
  });

  const events: EventInput[] = (data ?? []).map((t) => {
    const start = toWall(t.startAt ?? t.dueAt!);
    const end = t.startAt && t.dueAt ? toWall(t.dueAt) : new Date(start.getTime() + HALF_HOUR);
    return {
      id: t.id,
      title: t.title,
      start,
      end,
      backgroundColor: t.status.color,
      borderColor: t.priority?.color ?? t.status.color,
      editable: t.can.edit,
      extendedProps: { task: t },
    };
  });

  const reschedule = async (arg: EventDropArg | EventResizeDoneArg) => {
    const t = arg.event.extendedProps.task as Task;
    const start = fromWall(arg.event.start!);
    const end = arg.event.end ? fromWall(arg.event.end) : new Date(start.getTime() + HALF_HOUR);
    // Una tarea solo con vencimiento se mueve como un punto en el tiempo.
    const body = t.startAt
      ? { startAt: start.toISOString(), dueAt: end.toISOString() }
      : { startAt: null, dueAt: start.toISOString() };
    try {
      await api.put(`/tasks/${t.id}/schedule`, { ...body, version: t.version });
      toast.success('Fechas actualizadas.');
    } catch (e) {
      arg.revert();
      toast.error(errorMessage(e));
    } finally {
      await qc.invalidateQueries({ queryKey: ['tasks'] });
    }
  };

  return (
    <div className="task-calendar rounded-lg border border-border bg-surface p-3">
      <FullCalendar
        plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
        locale={esLocale}
        timeZone="UTC"
        now={() => toWall(new Date())}
        eventTimeFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
        slotLabelFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
        initialView="dayGridMonth"
        headerToolbar={{
          left: 'prev,next today',
          center: 'title',
          right: 'dayGridMonth,timeGridWeek,timeGridDay',
        }}
        height="auto"
        nowIndicator
        dayMaxEvents={4}
        events={events}
        selectable={!!onCreate}
        select={(s: DateSelectArg) =>
          onCreate?.(fromWall(s.start).toISOString(), fromWall(s.end).toISOString())
        }
        eventDrop={(a) => void reschedule(a)}
        eventResize={(a) => void reschedule(a)}
        eventClick={(a) => onOpen(a.event.id)}
        datesSet={(d) =>
          setRange({ from: fromWall(d.start).toISOString(), to: fromWall(d.end).toISOString() })
        }
        eventContent={(arg: EventContentArg) => <EventLabel arg={arg} />}
      />
    </div>
  );
}

function EventLabel({ arg }: { arg: EventContentArg }) {
  const t = arg.event.extendedProps.task as Task;
  const Icon = STAGE_KIND[t.status.category].icon;
  return (
    <span className="flex min-w-0 items-center gap-1 px-1 text-xs">
      {t.overdue ? (
        <AlertTriangle className="h-3 w-3 shrink-0" aria-label="Vencida" />
      ) : (
        <Icon className="h-3 w-3 shrink-0" aria-label={t.status.name} />
      )}
      {arg.timeText && <span className="shrink-0">{arg.timeText}</span>}
      <span className="truncate">{t.title}</span>
    </span>
  );
}
