export const MANIFEST_SCHEMA_VERSION = 'move-with-musto.mls-source-manifest.v1';

export const CORE_UPDATE_FILES = Object.freeze([
    'agents.txt',
    'idx_cc.txt',
    'idx_mf.txt',
    'idx_OH.txt',
    'idx_sf.txt',
    'idx_VT.txt',
    'offices.txt',
    'optout.txt',
]);

export const REFERENCE_FILES = Object.freeze([
    'areas.txt',
    'counties.txt',
    'field_reference.txt',
    'towns.txt',
]);

export const OPTIONAL_FILES = Object.freeze(['reference_updates.txt']);

// Commercial data is optional for residential refreshes, but these three
// exports are one logical package and must never be accepted piecemeal.
export const COMMERCIAL_UPDATE_FILES = Object.freeze([
    'idx_bu.txt',
    'idx_ci.txt',
    'idx_ld.txt',
]);

export const ALLOWED_SOURCE_FILES = Object.freeze([
    ...CORE_UPDATE_FILES,
    ...REFERENCE_FILES,
    ...OPTIONAL_FILES,
    ...COMMERCIAL_UPDATE_FILES,
].sort((left, right) => left.localeCompare(right)));

export const MAX_FILE_BYTES = 150 * 1024 * 1024;
export const MAX_PACKAGE_BYTES = 500 * 1024 * 1024;
export const UPLOAD_URL_TTL_SECONDS = 15 * 60;
export const RUN_RECORD_TTL_DAYS = 90;

export const RUN_STATES = Object.freeze({
    UPLOAD_PENDING: 'UPLOAD_PENDING',
    UPLOADED: 'UPLOADED',
    VALIDATING: 'VALIDATING',
    AWAITING_REVIEW: 'AWAITING_REVIEW',
    VALIDATION_FAILED: 'VALIDATION_FAILED',
    APPROVED: 'APPROVED',
    REJECTED: 'REJECTED',
    PUBLISHING: 'PUBLISHING',
    PUBLISH_FAILED: 'PUBLISH_FAILED',
    PUBLISHED: 'PUBLISHED',
    EXPIRED: 'EXPIRED',
});

export const ACTION_TRANSITIONS = Object.freeze({
    validate: {
        from: [RUN_STATES.UPLOADED, RUN_STATES.VALIDATION_FAILED],
        pending: RUN_STATES.VALIDATING,
        buildAction: 'VALIDATE',
    },
    approve: {
        from: [RUN_STATES.AWAITING_REVIEW],
        pending: RUN_STATES.APPROVED,
    },
    reject: {
        from: [RUN_STATES.AWAITING_REVIEW, RUN_STATES.APPROVED],
        pending: RUN_STATES.REJECTED,
    },
    publish: {
        from: [RUN_STATES.APPROVED, RUN_STATES.PUBLISH_FAILED],
        pending: RUN_STATES.PUBLISHING,
        buildAction: 'PUBLISH',
    },
});
