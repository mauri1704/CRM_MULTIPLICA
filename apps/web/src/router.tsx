import { createBrowserRouter } from 'react-router';
import { AppLayout } from '@/components/layout/app-layout';
import { RequireAuth, RequirePermission } from '@/components/layout/guards';
import { AuditPage } from '@/features/admin/audit-page';
import { CatalogsPage } from '@/features/admin/catalogs-page';
import { CustomFieldsPage } from '@/features/admin/custom-fields-page';
import { OrganizationPage } from '@/features/admin/organization-page';
import { PipelinesPage } from '@/features/admin/pipelines-page';
import { RolesPage } from '@/features/admin/roles-page';
import { TeamsPage } from '@/features/admin/teams-page';
import { UsersPage } from '@/features/admin/users-page';
import { ForgotPasswordPage } from '@/features/auth/forgot-password-page';
import { LoginPage } from '@/features/auth/login-page';
import { ResetPasswordPage } from '@/features/auth/reset-password-page';
import { HomePage } from '@/features/home/home-page';
import { NotFoundPage } from '@/features/home/not-found-page';
import { TrashPage } from '@/features/trash/trash-page';
import { CompaniesPage } from '@/features/companies/companies-page';
import { ContactsPage } from '@/features/contacts/contacts-page';
import { ImportsPage } from '@/features/import-export/imports-page';
import { CurrenciesPage } from '@/features/money/currencies-page';
import { ExchangeRatesPage } from '@/features/money/exchange-rates-page';
import { ProductsPage } from '@/features/products/products-page';

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/recuperar-clave', element: <ForgotPasswordPage /> },
  { path: '/restablecer-clave', element: <ResetPasswordPage /> },
  {
    element: (
      <RequireAuth>
        <AppLayout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <HomePage /> },
      {
        path: 'contactos',
        element: (
          <RequirePermission module="contacts" action="view">
            <ContactsPage />
          </RequirePermission>
        ),
      },
      {
        path: 'companias',
        element: (
          <RequirePermission module="companies" action="view">
            <CompaniesPage />
          </RequirePermission>
        ),
      },
      {
        path: 'productos',
        element: (
          <RequirePermission module="products" action="view">
            <ProductsPage />
          </RequirePermission>
        ),
      },
      { path: 'importaciones', element: <ImportsPage /> },
      {
        path: 'admin/monedas',
        element: (
          <RequirePermission module="currencies" action="view">
            <CurrenciesPage />
          </RequirePermission>
        ),
      },
      {
        path: 'admin/tipos-de-cambio',
        element: (
          <RequirePermission module="exchange_rates" action="view">
            <ExchangeRatesPage />
          </RequirePermission>
        ),
      },
      {
        path: 'papelera',
        element: (
          <RequirePermission module="trash" action="view">
            <TrashPage />
          </RequirePermission>
        ),
      },
      {
        path: 'admin/organizacion',
        element: (
          <RequirePermission module="settings" action="view">
            <OrganizationPage />
          </RequirePermission>
        ),
      },
      {
        path: 'admin/usuarios',
        element: (
          <RequirePermission module="users" action="view">
            <UsersPage />
          </RequirePermission>
        ),
      },
      {
        path: 'admin/equipos',
        element: (
          <RequirePermission module="teams" action="view">
            <TeamsPage />
          </RequirePermission>
        ),
      },
      {
        path: 'admin/roles',
        element: (
          <RequirePermission module="roles" action="view">
            <RolesPage />
          </RequirePermission>
        ),
      },
      {
        path: 'admin/pipelines',
        element: (
          <RequirePermission module="settings" action="view">
            <PipelinesPage />
          </RequirePermission>
        ),
      },
      {
        path: 'admin/catalogos',
        element: (
          <RequirePermission module="settings" action="view">
            <CatalogsPage />
          </RequirePermission>
        ),
      },
      {
        path: 'admin/campos',
        element: (
          <RequirePermission module="settings" action="view">
            <CustomFieldsPage />
          </RequirePermission>
        ),
      },
      {
        path: 'admin/auditoria',
        element: (
          <RequirePermission module="audit" action="view">
            <AuditPage />
          </RequirePermission>
        ),
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
