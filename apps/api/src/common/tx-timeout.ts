import { SetMetadata } from '@nestjs/common';

export const TX_TIMEOUT = 'crm:tx-timeout';

/** Tiempo máximo de la transacción de la petición (por defecto 20 s). Para importar/exportar. */
export const TxTimeout = (ms: number) => SetMetadata(TX_TIMEOUT, ms);
