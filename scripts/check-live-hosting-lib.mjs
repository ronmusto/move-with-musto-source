import {
    assertFreshMlsTimestamp,
    MLS_PIN_MAX_PUBLIC_AGE_MS,
} from './mls-publication-lib.mjs';

export { MLS_PIN_MAX_PUBLIC_AGE_MS };

export function assertFreshMlsCurrentPointer(pointer, now = Date.now()) {
    if (typeof pointer?.generatedAt !== 'string') {
        throw new Error('MLS current pointer does not contain a valid generatedAt timestamp.');
    }
    assertFreshMlsTimestamp(pointer.generatedAt, now);
}
