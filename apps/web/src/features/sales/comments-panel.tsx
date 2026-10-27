import type { CommentTarget } from '@crm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AtSign, MessageSquare, Send, X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea, Select } from '@/components/ui/input';
import { EmptyState, Spinner } from '@/components/ui/misc';
import { useToast } from '@/components/ui/toast';
import { api, errorMessage } from '@/lib/api';
import { useUser } from '@/lib/auth';
import { relativeTime } from '@/lib/format';
import { useUserOptions } from '@/lib/hooks';
import type { CommentItem } from '@/lib/types';

/** Comentarios de una ficha, con menciones que notifican a los usuarios elegidos. */
export function CommentsPanel({ type, id }: { type: CommentTarget; id: string }) {
  const me = useUser();
  const qc = useQueryClient();
  const toast = useToast();
  const users = useUserOptions();
  const key = ['comments', type, id];
  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => api.get<CommentItem[]>(`/comments/${type.toLowerCase()}/${id}`),
  });
  const [body, setBody] = useState('');
  const [mentions, setMentions] = useState<string[]>([]);
  const post = useMutation({
    mutationFn: () => api.post(`/comments/${type.toLowerCase()}/${id}`, { body, mentions }),
    onSuccess: async () => {
      setBody('');
      setMentions([]);
      await qc.invalidateQueries({ queryKey: key });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (commentId: string) => api.delete(`/comments/${commentId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });
  const name = (uid: string) => users.data?.find((u) => u.id === uid)?.name ?? '';

  return (
    <div className="space-y-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (body.trim()) post.mutate();
        }}
        className="space-y-2"
      >
        <label htmlFor="comment-body" className="sr-only">
          Nuevo comentario
        </label>
        <Textarea
          id="comment-body"
          rows={3}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Escriba un comentario…"
        />
        <div className="flex flex-wrap items-center gap-2">
          <AtSign className="h-4 w-4 text-fg-muted" aria-hidden />
          <Select
            aria-label="Notificar a"
            value=""
            onChange={(e) =>
              e.target.value &&
              !mentions.includes(e.target.value) &&
              setMentions([...mentions, e.target.value])
            }
            className="h-8 w-48 text-xs"
          >
            <option value="">Notificar a…</option>
            {users.data
              ?.filter((u) => u.id !== me.id && !mentions.includes(u.id))
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
          </Select>
          {mentions.map((m) => (
            <span
              key={m}
              className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary"
            >
              @{name(m)}
              <button
                type="button"
                aria-label={`Quitar a ${name(m)}`}
                onClick={() => setMentions(mentions.filter((x) => x !== m))}
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            </span>
          ))}
          <Button
            type="submit"
            size="sm"
            className="ml-auto"
            loading={post.isPending}
            disabled={!body.trim()}
          >
            <Send className="h-4 w-4" aria-hidden />
            Comentar
          </Button>
        </div>
      </form>
      {isLoading && <Spinner />}
      {data && data.length === 0 && <EmptyState icon={MessageSquare} title="Sin comentarios" />}
      <ol className="space-y-3">
        {data?.map((c) => (
          <li key={c.id} className="rounded-md border border-border p-3 text-sm">
            <div className="mb-1 flex items-center justify-between gap-2 text-xs text-fg-muted">
              <span>
                <strong className="text-fg">{c.author.name}</strong> · {relativeTime(c.createdAt)}
                {c.editedAt && ' · editado'}
              </span>
              {c.mine && (
                <button
                  type="button"
                  className="hover:text-danger"
                  onClick={() => remove.mutate(c.id)}
                >
                  Eliminar
                </button>
              )}
            </div>
            <p className="whitespace-pre-wrap">{c.body}</p>
            {c.mentions.length > 0 && (
              <p className="mt-1 text-xs text-primary">
                {c.mentions.map((m) => `@${m.name}`).join(' ')}
              </p>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
