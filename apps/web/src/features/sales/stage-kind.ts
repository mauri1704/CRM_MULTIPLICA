import {
  Ban,
  CheckCircle2,
  CircleDot,
  Eye,
  Loader,
  Repeat,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import type { StageRef } from '@/lib/types';

type Tone = 'neutral' | 'success' | 'danger' | 'warning' | 'primary';

/** Ícono y tono por tipo de etapa o categoría de estado: el estado nunca depende solo del color. */
export const STAGE_KIND: Record<StageRef['kind'], { icon: LucideIcon; tone: Tone }> = {
  OPEN: { icon: CircleDot, tone: 'neutral' },
  IN_PROGRESS: { icon: Loader, tone: 'primary' },
  REVIEW: { icon: Eye, tone: 'warning' },
  DONE: { icon: CheckCircle2, tone: 'success' },
  CANCELED: { icon: Ban, tone: 'danger' },
  WON: { icon: CheckCircle2, tone: 'success' },
  LOST: { icon: XCircle, tone: 'danger' },
  CONVERTED: { icon: Repeat, tone: 'primary' },
};
