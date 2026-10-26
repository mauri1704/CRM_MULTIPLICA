/** Variables para las pruebas de integración: siempre contra la base de pruebas. */
try {
  process.loadEnvFile('.env');
} catch {
  // En CI las variables vienen del entorno.
}
const testUrl = process.env.TEST_DATABASE_URL;
const testAppUrl = process.env.TEST_APP_DATABASE_URL;
if (!testUrl || !testAppUrl) throw new Error('Defina TEST_DATABASE_URL y TEST_APP_DATABASE_URL.');
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = testUrl;
process.env.APP_DATABASE_URL = testAppUrl;
process.env.SMTP_URL = '';
