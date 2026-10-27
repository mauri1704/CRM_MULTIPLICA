import { Module } from '@nestjs/common';
import { CompaniesService } from './companies/companies.service';
import { ContactsService } from './contacts/contacts.service';
import { CurrenciesService } from './currencies/currencies.service';
import { ExchangeRatesService } from './exchange-rates/exchange-rates.service';
import { ProductsService } from './products/products.service';
import { TeamsService } from './teams/teams.service';

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
];

@Module({ providers: services, exports: services })
export class DomainModule {}
