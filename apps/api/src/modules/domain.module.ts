import { Module } from '@nestjs/common';
import { CompaniesService } from './companies/companies.service';
import { ContactsService } from './contacts/contacts.service';
import { CurrenciesService } from './currencies/currencies.service';
import { ExchangeRatesService } from './exchange-rates/exchange-rates.service';
import { ProductsService } from './products/products.service';
import { TeamsService } from './teams/teams.service';
import { DealsService } from './deals/deals.service';
import { LeadsService } from './leads/leads.service';
import { LineItemsService } from './sales/line-items.service';
import { StagesService } from './sales/stages';

/**
 * Servicios de dominio. Se cargan también en el worker para que registren sus manejadores de
 * papelera y la purga por retención los encuentre.
 */
const services = [
  TeamsService,
  CurrenciesService,
  ExchangeRatesService,
  ProductsService,
  CompaniesService,
  ContactsService,
  StagesService,
  LineItemsService,
  LeadsService,
  DealsService,
];

@Module({ providers: services, exports: services })
export class DomainModule {}
