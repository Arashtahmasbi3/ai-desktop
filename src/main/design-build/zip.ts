import { zipStore, crc32 } from '@shared/zip-store'

/**
 * The design build's zip writer used to live here; the implementation moved to `@shared/zip-store` so the Office builders
 * in `core` can use it too without a layer violation. This module stays as the import path existing code and tests use.
 */
export { crc32, zipStore }
