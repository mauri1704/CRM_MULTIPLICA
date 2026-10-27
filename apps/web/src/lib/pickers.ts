import type { PickerOption } from '@/components/ui/entity-picker';
import { api } from './api';
import type { Company, Contact, Page } from './types';

export const searchCompanies = async (q: string): Promise<PickerOption[]> =>
  (await api.get<Page<Company>>('/companies', { q, pageSize: 20 })).items.map((c) => ({
    id: c.id,
    label: c.legalName,
    sublabel: [c.code, c.taxId].filter(Boolean).join(' · '),
  }));

export const searchContacts = async (q: string): Promise<PickerOption[]> =>
  (await api.get<Page<Contact>>('/contacts', { q, pageSize: 20 })).items.map((c) => ({
    id: c.id,
    label: c.fullName,
    sublabel: [c.code, c.email, c.company?.legalName].filter(Boolean).join(' · '),
  }));
