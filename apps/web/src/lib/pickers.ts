import type { PickerOption } from '@/components/ui/entity-picker';
import { api } from './api';
import type { Company, Contact, Deal, Lead, Page } from './types';

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

export const searchLeads = async (q: string): Promise<PickerOption[]> =>
  (await api.get<Page<Lead>>('/leads', { q, pageSize: 20 })).items.map((l) => ({
    id: l.id,
    label: l.title,
    sublabel: [l.code, l.company?.legalName].filter(Boolean).join(' · '),
  }));

export const searchDeals = async (q: string): Promise<PickerOption[]> =>
  (await api.get<Page<Deal>>('/deals', { q, pageSize: 20 })).items.map((d) => ({
    id: d.id,
    label: d.title,
    sublabel: [d.code, d.company?.legalName].filter(Boolean).join(' · '),
  }));
