import { isNative } from '../../mobile/platform';

export const embeddingsAvailable = (view = globalThis) => Boolean(
    view?.indexedDB && !isNative()
);
