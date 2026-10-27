import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { CheckCircle2, CircleDot, Repeat, XCircle } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { useMoney } from '@/lib/money';
import type { BoardColumn, StageRef } from '@/lib/types';

const KIND_ICON = { OPEN: CircleDot, WON: CheckCircle2, LOST: XCircle, CONVERTED: Repeat } as const;

interface KanbanProps<T extends { id: string }> {
  columns: BoardColumn<T>[];
  renderCard: (item: T) => ReactNode;
  onOpen: (item: T) => void;
  /**
   * Se llama al soltar una tarjeta. Si devuelve false o lanza, la tarjeta vuelve a su lugar.
   * Puede abrir un diálogo (motivo de pérdida, valor final…) antes de confirmar.
   */
  onMove: (item: T, to: StageRef, index: number) => Promise<boolean>;
  canMove: (item: T) => boolean;
}

/**
 * Tablero por etapas. Arrastrar con ratón, táctil o teclado (Tab hasta la tarjeta, Espacio para
 * tomarla, flechas para moverla, Espacio para soltar, Escape para cancelar).
 */
export function KanbanBoard<T extends { id: string }>({
  columns,
  renderCard,
  onOpen,
  onMove,
  canMove,
}: KanbanProps<T>) {
  const money = useMoney();
  const [local, setLocal] = useState(columns);
  const [active, setActive] = useState<T | null>(null);
  useEffect(() => setLocal(columns), [columns]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const findColumn = (id: string) =>
    local.findIndex((c) => c.stage.id === id || c.items.some((i) => i.id === id));

  const onDragStart = (e: DragStartEvent) => {
    const col = local[findColumn(String(e.active.id))];
    setActive(col?.items.find((i) => i.id === e.active.id) ?? null);
  };

  const onDragEnd = async (e: DragEndEvent) => {
    setActive(null);
    const { active: a, over } = e;
    if (!over) return;
    const fromIdx = findColumn(String(a.id));
    const toIdx = findColumn(String(over.id));
    const from = local[fromIdx];
    const to = local[toIdx];
    if (!from || !to) return;
    const item = from.items.find((i) => i.id === a.id);
    if (!item) return;
    const targetItems = to.items.filter((i) => i.id !== item.id);
    const overIndex = targetItems.findIndex((i) => i.id === over.id);
    const index = overIndex >= 0 ? overIndex : targetItems.length;
    const sameSpot = fromIdx === toIdx && from.items.findIndex((i) => i.id === item.id) === index;
    if (sameSpot) return;
    const previous = local;
    // Movimiento optimista; se revierte si el servidor o el usuario lo rechazan.
    setLocal(
      local.map((c, i) => {
        let items = c.items.filter((x) => x.id !== item.id);
        if (i === toIdx) items = [...items.slice(0, index), item, ...items.slice(index)];
        return { ...c, items, count: items.length };
      }),
    );
    try {
      const ok = await onMove(item, to.stage, index);
      if (!ok) setLocal(previous);
    } catch {
      setLocal(previous);
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragEnd={(e) => void onDragEnd(e)}
      onDragCancel={() => setActive(null)}
      accessibility={{
        screenReaderInstructions: {
          draggable:
            'Para mover la tarjeta, pulse Espacio, use las flechas y pulse Espacio para soltarla. Escape cancela.',
        },
      }}
    >
      <div className="flex gap-3 overflow-x-auto pb-4" role="list" aria-label="Etapas">
        {local.map((col) => (
          <Column
            key={col.stage.id}
            column={col}
            sums={col.sums.map((s) => money(s.amount, s.currencyCode)).join(' · ')}
          >
            <SortableContext
              items={col.items.map((i) => i.id)}
              strategy={verticalListSortingStrategy}
            >
              {col.items.map((item) => (
                <Card
                  key={item.id}
                  id={item.id}
                  disabled={!canMove(item)}
                  onOpen={() => onOpen(item)}
                >
                  {renderCard(item)}
                </Card>
              ))}
            </SortableContext>
          </Column>
        ))}
      </div>
      <DragOverlay>
        {active ? (
          <div className="rotate-2 rounded-lg border border-primary bg-surface p-3 shadow-xl">
            {renderCard(active)}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function Column({
  column,
  sums,
  children,
}: {
  column: BoardColumn<{ id: string }>;
  sums: string;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.stage.id });
  const Icon = KIND_ICON[column.stage.kind];
  return (
    <section
      ref={setNodeRef}
      role="listitem"
      aria-label={`${column.stage.name}: ${column.count} registro(s)`}
      className={cn(
        'flex w-72 shrink-0 flex-col rounded-lg border border-border bg-muted/40',
        isOver && 'border-primary bg-primary/5',
      )}
    >
      <header
        className="border-b border-border p-3"
        style={{
          borderTopColor: column.stage.color,
          borderTopWidth: 3,
          borderTopLeftRadius: 8,
          borderTopRightRadius: 8,
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">
            <Icon className="h-4 w-4" style={{ color: column.stage.color }} aria-hidden />
            {column.stage.name}
          </h2>
          <span className="rounded-full bg-surface px-2 text-xs text-fg-muted">{column.count}</span>
        </div>
        <p className="mt-1 min-h-4 text-xs text-fg-muted">{sums || '—'}</p>
      </header>
      <div className="flex min-h-[120px] flex-1 flex-col gap-2 p-2">{children}</div>
    </section>
  );
}

function Card({
  id,
  disabled,
  onOpen,
  children,
}: {
  id: string;
  disabled: boolean;
  onOpen: () => void;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled,
  });
  return (
    <article
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
      onClick={onOpen}
      onKeyDown={(e) => {
        listeners?.onKeyDown?.(e);
        if (e.key === 'Enter') onOpen();
      }}
      className={cn(
        'cursor-pointer rounded-lg border border-border bg-surface p-3 text-sm shadow-sm hover:border-primary/50',
        isDragging && 'opacity-40',
        disabled && 'cursor-default',
      )}
    >
      {children}
    </article>
  );
}
