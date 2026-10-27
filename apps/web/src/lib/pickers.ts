import type { PickerOption } from '@/components/ui/entity-picker';
import { api } from './api';
import type { Company, Page } from './types';

export const searchCompanies = async (q: string): Promise<PickerOption[]> =>
  (await api.get<Page<Company>>('/companies', { q, pageSize: 20 })).items.map((c) => ({
    id: c.id,
    label: c.legalName,
    sublabel: [c.code, c.taxId].filter(Boolean).join(' · '),
  }));
