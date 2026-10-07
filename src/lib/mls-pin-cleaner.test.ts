import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
    ACTIVE_PUBLIC_STATUSES,
    buildMlsCoordinateIndex,
    buildMlsSearchDelivery,
    buildPublicListingOutputs,
    buildPhotoUrls,
    CANONICAL_SERVICE_AREA_TOWNS,
    CANONICAL_SERVICE_MARKET_AREA,
    cleanSalesRows,
    decodeMlsText,
    listingIsMassachusetts,
    MLS_ALLOWED_STATE,
    MLS_PIN_PUBLIC_DISCLAIMER,
    normalizeMlsState,
    parsePipeDelimited,
    serializeMlsJson,
    validateComplianceConfig,
} from '../../scripts/mls-pin-cleaner-lib.mjs';

const complianceConfig = {
    participantFirmName: 'Test Participant Realty',
    officeAddress: '123 Main Street, Salem, MA 01970',
    phone: '(781) 315-3845',
    marketArea: CANONICAL_SERVICE_AREA_TOWNS,
};

const references = {
    towns: new Map([
        ['1', { town: 'Boston', countyCode: 'SUFF', state: 'MA' }],
        ['12', { town: 'Brookline', countyCode: 'NORF', state: 'MA' }],
    ]),
    areas: new Map([
        ['102', 'Beacon Hill'],
    ]),
    counties: new Map([
        ['SUFF', 'Suffolk'],
        ['NORF', 'Norfolk'],
    ]),
    offices: new Map([
        ['BB5984', { name: 'Beacon Office', phone: '617-555-0100' }],
        ['OPT001', { name: 'Opt Out Realty', phone: '617-555-0111' }],
    ]),
    agents: new Map([
        ['BB904054', 'Avery Agent'],
        ['BB803957', 'Blake Broker'],
    ]),
    openHouses: new Map([
        ['73333444', [{
            start: '2026-06-27T10:00:00',
            end: '2026-06-27T13:00:00',
            type: 'In-Person',
            url: '',
        }]],
    ]),
    virtualTours: new Map([
        ['73333444', 'https://example.com/tour'],
    ]),
    fieldReference: new Map([
        ['STYLE:P', 'Victorian'],
        ['ROOM:A', 'Bathroom - Full'],
        ['ROOM:I', 'Closet - Walk-in'],
        ['ROOM_NAME:EHL', 'Entry Hall'],
        ['HEATING:H', 'Hot Water Baseboard'],
        ['INTERIOR_FEATURES:C', 'Cable Available'],
        ['WATERFRONT_FLAG:N', 'No'],
        ['ADULT_COMMUNITY:Y', 'Yes'],
    ]),
};

function validSalesRow(overrides: Record<string, string> = {}) {
    return {
        PROP_TYPE: 'SF',
        LIST_NO: '73333444',
        LIST_AGENT: 'BB904054',
        LIST_OFFICE: 'BB5984',
        STATUS: 'ACT',
        LIST_PRICE: '899000',
        STREET_NO: '86',
        STREET_NAME: 'Mount Vernon Street',
        UNIT_NO: '',
        TOWN_NUM: '1',
        AREA: '102',
        ZIP_CODE: '02108',
        STATE: 'MA',
        REMARKS: 'Source-faithful public remarks.',
        PHOTO_COUNT: '2',
        NO_BEDROOMS: '3',
        NO_FULL_BATHS: '2',
        NO_HALF_BATHS: '1',
        SQUARE_FEET: '1800',
        COUNTY: 'Suffolk',
        LISTING_ALERT: 'N',
        ...overrides,
    };
}

describe('validateComplianceConfig', () => {
    it('requires participant display fields before publishing', () => {
        expect(() =>
            validateComplianceConfig({
                ...complianceConfig,
                officeAddress: '',
            }),
        ).toThrow(/officeAddress/);
    });

    it('rejects placeholder display fields and normalizes the canonical market-area towns', () => {
        expect(() => validateComplianceConfig({
            ...complianceConfig,
            officeAddress: 'Broker-approved office address goes here',
        })).toThrow(/Placeholder.*officeAddress/);

        expect(validateComplianceConfig(complianceConfig).marketArea).toBe(CANONICAL_SERVICE_MARKET_AREA);
    });

    it('rejects missing, unexpected, duplicate, or reordered service towns', () => {
        expect(() => validateComplianceConfig({
            ...complianceConfig,
            marketArea: CANONICAL_SERVICE_AREA_TOWNS.filter((town) => town !== 'Burlington'),
        })).toThrow(/exactly the 106.*missing towns: Burlington/i);

        expect(() => validateComplianceConfig({
            ...complianceConfig,
            marketArea: [...CANONICAL_SERVICE_AREA_TOWNS, 'Worcester'],
        })).toThrow(/unexpected towns: Worcester/i);

        expect(() => validateComplianceConfig({
            ...complianceConfig,
            marketArea: [...CANONICAL_SERVICE_AREA_TOWNS, 'Burlington'],
        })).toThrow(/duplicate towns: Burlington/i);

        expect(() => validateComplianceConfig({
            ...complianceConfig,
            marketArea: [...CANONICAL_SERVICE_AREA_TOWNS].reverse(),
        })).toThrow(/canonical alphabetical town order and spelling/i);
    });
});

describe('buildPhotoUrls', () => {
    it('generates MLS PIN media URLs capped to 42 photos', () => {
        const photos = buildPhotoUrls('73333444', '99');

        expect(photos).toHaveLength(42);
        expect(photos[0]).toEqual({
            index: 0,
            card: 'https://media.mlspin.com/photo.aspx?mls=73333444&n=0&w=600&h=450',
            detail: 'https://media.mlspin.com/photo.aspx?mls=73333444&n=0&w=1024&h=768',
            thumbnail: 'https://media.mlspin.com/photo.aspx?mls=73333444&n=0&w=320&h=250',
        });
        expect(photos[41].detail).toContain('n=41');
    });
});

describe('expiring coordinate sidecar', () => {
    const now = Date.parse('2026-07-13T12:00:00.000Z');

    function coordinateIndexFor(mapPosition: Record<string, unknown>) {
        return buildMlsCoordinateIndex({
            generatedAt: '2026-07-13T12:00:00.000Z',
            listings: [{ listingNumber: '73333444', mapPosition }],
        }, now);
    }

    it('publishes only coordinates with a valid 30-day source lifetime and four-day deletion margin', () => {
        expect(Object.keys(coordinateIndexFor({
            lat: 42.3588,
            lng: -71.0707,
            geocodedAt: '2026-07-10T12:00:00.000Z',
            expiresAt: '2026-08-09T12:00:00.000Z',
        }).coordinates)).toEqual(['73333444']);

        expect(coordinateIndexFor({
            lat: 42.3588,
            lng: -71.0707,
            geocodedAt: '2026-05-01T12:00:00.000Z',
            expiresAt: '2026-08-09T12:00:00.000Z',
        }).coordinates).toEqual({});

        expect(coordinateIndexFor({
            lat: 42.3588,
            lng: -71.0707,
            geocodedAt: '2026-06-17T12:00:00.000Z',
            expiresAt: '2026-07-17T11:59:59.000Z',
        }).coordinates).toEqual({});
    });
});

describe('MLS PIN text decoding', () => {
    it('decodes Windows-1252 remarks before parsing pipe-delimited rows', () => {
        const text = decodeMlsText(Buffer.concat([
            Buffer.from('LIST_NO|REMARKS\n73333444|Boston', 'ascii'),
            Buffer.from([0x92]),
            Buffer.from('s 20', 'ascii'),
            Buffer.from([0x92]),
            Buffer.from(' wide', 'ascii'),
        ]));
        const rows = parsePipeDelimited(text);

        expect(rows[0].REMARKS).toBe('Boston\u2019s 20\u2019 wide');
        expect(rows[0].REMARKS).not.toContain('\uFFFD');
    });
});

describe('Massachusetts MLS ingest invariant', () => {
    it('normalizes state input and recognizes only Massachusetts listings', () => {
        expect(MLS_ALLOWED_STATE).toBe('MA');
        expect(normalizeMlsState(' ma ')).toBe('MA');
        expect(normalizeMlsState(' nh ')).toBe('NH');
        expect(listingIsMassachusetts({ address: { state: ' ma ' } })).toBe(true);
        expect(listingIsMassachusetts({ address: { state: 'NH' } })).toBe(false);
    });

    it('publishes canonical Massachusetts rows, excludes other states, and quarantines reference conflicts', () => {
        const stateBoundaryReferences = {
            ...references,
            towns: new Map([
                ...references.towns,
                ['90', { town: 'Portsmouth', countyCode: 'SUFF', state: 'NH' }],
                ['91', { town: 'Lowell', countyCode: 'SUFF', state: '' }],
            ]),
        };
        const result = cleanSalesRows({
            rows: [
                validSalesRow({
                    LIST_NO: '73334001',
                    STATE: ' ma ',
                }),
                validSalesRow({
                    LIST_NO: '73334002',
                    STREET_NAME: 'Outside State Road',
                    TOWN_NUM: '90',
                    STATE: ' nh ',
                }),
                validSalesRow({
                    LIST_NO: '73334003',
                    STREET_NAME: 'Conflicting Reference Road',
                    TOWN_NUM: '90',
                    STATE: 'MA',
                }),
                validSalesRow({
                    LIST_NO: '73334004',
                    STREET_NAME: 'Conflicting Row Road',
                    TOWN_NUM: '1',
                    STATE: 'NH',
                }),
                validSalesRow({
                    LIST_NO: '73334005',
                    STREET_NAME: 'Legacy Reference Road',
                    TOWN_NUM: '91',
                    STATE: 'MA',
                }),
            ],
            propertyClass: 'single-family',
            references: stateBoundaryReferences,
            optOutOfficeIds: new Set(),
            complianceConfig,
        });

        expect(result.listings.map((item) => item.listingNumber)).toEqual([
            '73334001',
            '73334005',
        ]);
        expect(result.listings.map((item) => item.address)).toEqual([
            expect.objectContaining({ town: 'Boston', state: 'MA' }),
            expect.objectContaining({ town: 'Lowell', state: 'MA' }),
        ]);
        expect(result.report).toMatchObject({
            published: 2,
            quarantined: 2,
            byInputState: { MA: 3, NH: 2 },
            byState: { MA: 2 },
            excludedOutsideMassachusetts: 1,
            excludedByState: { NH: 1 },
            stateReferenceMismatches: 2,
        });
        expect(result.quarantined).toEqual(expect.arrayContaining([
            expect.objectContaining({
                listingNumber: '73334003',
                reasons: ['state_reference_mismatch'],
            }),
            expect.objectContaining({
                listingNumber: '73334004',
                reasons: ['state_reference_mismatch'],
            }),
        ]));
        expect(result.quarantined).not.toEqual(expect.arrayContaining([
            expect.objectContaining({ listingNumber: '73334002' }),
        ]));
    });
});

describe('cleanSalesRows', () => {
    it('publishes only compliant active sales rows and quarantines invalid rows', () => {
        const result = cleanSalesRows({
            rows: [
                {
                    PROP_TYPE: 'SF',
                    LIST_NO: '73333444',
                    LIST_AGENT: 'BB904054',
                    LIST_OFFICE: 'BB5984',
                    STATUS: 'ACT',
                    LIST_PRICE: '8990000',
                    STREET_NO: '86',
                    STREET_NAME: 'Mount Vernon Street',
                    UNIT_NO: '',
                    TOWN_NUM: '1',
                    AREA: '102',
                    ZIP_CODE: '02108',
                    STATE: 'MA',
                    REMARKS: 'Source-faithful public remarks.',
                    PHOTO_COUNT: '2',
                    NO_BEDROOMS: '5',
                    NO_FULL_BATHS: '4',
                    NO_HALF_BATHS: '2',
                    NO_ROOMS: '11',
                    SQUARE_FEET: '4492',
                    GARAGE_SPACES: '1',
                    BASEMENT: 'Y',
                    MBR_LEVEL: '2',
                    MBR_DIMEN: '23X11',
                    MBR_DSCRP: 'I',
                    OTH1_ROOM_NAME: 'EHL',
                    OTH1_LEVEL: '1',
                    OTH1_DSCRP: 'A',
                    HEATING: 'H',
                    INTERIOR_FEATURES: 'C',
                    COUNTY: 'Suffolk',
                    LISTING_ALERT: 'N',
                    STYLE: 'P',
                    WATERFRONT_FLAG: 'N',
                    ADULT_COMMUNITY: 'Y',
                },
                {
                    PROP_TYPE: 'SF',
                    LIST_NO: '73300001',
                    LIST_AGENT: 'BB803957',
                    LIST_OFFICE: 'OPT001',
                    STATUS: 'ACT',
                    LIST_PRICE: '1200000',
                    STREET_NO: '10',
                    STREET_NAME: 'Hidden Lane',
                    TOWN_NUM: '12',
                    STATE: 'MA',
                    REMARKS: 'Should be excluded by opt out.',
                    PHOTO_COUNT: '1',
                },
                {
                    PROP_TYPE: 'SF',
                    LIST_NO: '73300002',
                    LIST_AGENT: 'BB803957',
                    LIST_OFFICE: 'BB5984',
                    STATUS: 'UAG',
                    LIST_PRICE: '900000',
                    STREET_NO: '20',
                    STREET_NAME: 'Pending Road',
                    TOWN_NUM: '12',
                    STATE: 'MA',
                    REMARKS: 'Should be hidden in v1.',
                    PHOTO_COUNT: '1',
                },
                {
                    PROP_TYPE: 'SF',
                    LIST_NO: '',
                    LIST_AGENT: 'BB803957',
                    LIST_OFFICE: 'BB5984',
                    STATUS: 'ACT',
                    LIST_PRICE: '900000',
                    STREET_NO: '30',
                    STREET_NAME: 'Broken Road',
                    TOWN_NUM: '12',
                    STATE: 'MA',
                    REMARKS: 'Missing required listing number.',
                    PHOTO_COUNT: '1',
                },
                {
                    PROP_TYPE: 'SF',
                    LIST_NO: '73300003',
                    LIST_AGENT: 'BB803957',
                    LIST_OFFICE: 'BB5984',
                    STATUS: 'ACT',
                    LIST_PRICE: '950000',
                    STREET_NO: '40',
                    STREET_NAME: 'Review Road',
                    TOWN_NUM: '12',
                    STATE: 'MA',
                    REMARKS: 'Perfect for a growing family with a kids play room.',
                    PHOTO_COUNT: '1',
                },
            ],
            propertyClass: 'single-family',
            references,
            optOutOfficeIds: new Set(['OPT001']),
            complianceConfig,
        });

        expect(ACTIVE_PUBLIC_STATUSES).toContain('CTG');
        expect(result.listings).toHaveLength(2);
        expect(result.listings[0]).toMatchObject({
            listingNumber: '73333444',
            propertyType: 'Single family',
            status: {
                code: 'ACT',
                label: 'Active',
                isActive: true,
                isContingent: false,
            },
            address: {
                line: '86 Mount Vernon Street',
                town: 'Boston',
                area: 'Beacon Hill',
                county: 'Suffolk',
                state: 'MA',
                zip: '02108',
            },
            features: {
                style: ['Victorian'],
                waterfront: ['No'],
                heating: ['Hot Water Baseboard'],
                interior: ['Cable Available'],
                rooms: [
                    {
                        name: 'Primary bedroom',
                        level: 'Second',
                        dimensions: '23 x 11',
                        features: ['Closet - Walk-in'],
                    },
                    {
                        name: 'Entry Hall',
                        level: 'First',
                        dimensions: '',
                        features: ['Bathroom - Full'],
                    },
                ],
            },
            facts: {
                rooms: 11,
                garageSpaces: 1,
                hasBasement: true,
            },
            attribution: {
                listingAgent: 'Avery Agent',
                listingOffice: 'Beacon Office',
            },
        });
        expect(result.listings[0]).not.toHaveProperty('FIRM_RMKS');
        expect(result.listings[0].features).not.toHaveProperty('adultCommunity');
        expect(result.listings[0].photos).toHaveLength(2);
        expect(result.listings[0].openHouses).toHaveLength(1);
        expect(result.listings[0].virtualTourUrl).toBe('https://example.com/tour');
        expect(result.report.excludedByOptOut).toBe(1);
        const hiddenByStatus = result.report.hiddenByStatus as Record<string, number>;
        const byArea = result.report.byArea as Record<string, number>;
        expect(hiddenByStatus.UAG).toBe(1);
        expect(byArea['Beacon Hill']).toBe(1);
        expect(result.report.remarksSuppressed).toBe(1);
        expect(result.quarantined).toEqual([
            expect.objectContaining({
                listingNumber: 'unknown',
                reasons: ['missing_listing_number'],
            }),
        ]);
        expect(result.remarksReviews).toEqual([
            expect.objectContaining({
                listingNumber: '73300003',
                action: 'remarks_suppressed',
                remarksSha256: createHash('sha256')
                    .update('Perfect for a growing family with a kids play room.', 'utf8')
                    .digest('hex'),
                fairHousingFlags: expect.arrayContaining([
                    expect.objectContaining({ code: 'familial_status_preference' }),
                    expect.objectContaining({ code: 'children_reference' }),
                ]),
            }),
        ]);
        expect(result.listings.find((item) => item.listingNumber === '73300003')).toMatchObject({
            remarks: '',
        });
    });

    it.each([
        'http://example.com/tour',
        'NULL',
        'javascript:alert(1)',
        'https://localhost/tour',
    ])('suppresses an unsafe virtual-tour URL: %s', (virtualTourUrl) => {
        const result = cleanSalesRows({
            rows: [validSalesRow()],
            propertyClass: 'single-family',
            references: {
                ...references,
                virtualTours: new Map([['73333444', virtualTourUrl]]),
            },
            optOutOfficeIds: new Set(),
            complianceConfig,
        });

        expect(result.listings[0].virtualTourUrl).toBe('');
    });

    it('suppresses family-targeted marketing while retaining listings and neutral property terminology', () => {
        const flaggedRemarks = [
            'PENTHOUSE DUPLEX in family neighborhood. Works well for professionals, any growing family and roommates.',
            'Distinctive space and finishes growing families rarely find.',
            'Flexible bedrooms perfect for many uses and growing families.',
            'Additional rooms offer options for work and/or the growing family.',
            'A finished level offers flexibility for the growing family.',
            'A family-friendly atmosphere with flexibility for growing family.',
            'A family friendly setting near shops and restaurants.',
            'A family-oriented floor plan with flexible living areas.',
            'Located among established family neighbourhoods.',
            'Set on a family-friendly cul-de-sac with four levels of living space.',
            'Family friendly open concept design with four bedrooms upstairs.',
            'Welcome to this renovated home in a quiet, family-friendly neighborhood.',
            'New construction in a family-friendly neighborhood on a side street.',
            'This four-bedroom home is perfect for a single family.',
        ];
        const neutralRemarks = [
            'The first floor includes a spacious family room with a fireplace.',
            'This single-family home has three bedrooms and two baths.',
            'A great single-family home with three bedrooms and two baths.',
            'Picture-perfect Single Family (ca. 1860) with preserved details.',
            'A multi-family property with two separate units.',
            'Detached homes characterize this single family neighborhood.',
            'Investment options include this multi family neighborhood property.',
        ];
        const rows = [...flaggedRemarks, ...neutralRemarks].map((remarks, index) => validSalesRow({
            LIST_NO: String(73335000 + index),
            REMARKS: remarks,
        }));

        const result = cleanSalesRows({
            rows,
            propertyClass: 'single-family',
            references,
            optOutOfficeIds: new Set(),
            complianceConfig,
        });

        expect(result.report).toMatchObject({
            published: flaggedRemarks.length + neutralRemarks.length,
            quarantined: 0,
            remarksSuppressed: flaggedRemarks.length,
        });
        expect(result.quarantined).toEqual([]);
        expect(result.remarksReviews.map((record) => record.listingNumber)).toEqual(
            flaggedRemarks.map((_, index) => String(73335000 + index)),
        );
        expect(result.listings.map((item) => item.listingNumber)).toEqual(
            [...flaggedRemarks, ...neutralRemarks].map((_, index) => String(73335000 + index)),
        );
        expect(result.listings.slice(0, flaggedRemarks.length).every((item) => item.remarks === '')).toBe(true);
        expect(result.listings.slice(flaggedRemarks.length).map((item) => item.remarks)).toEqual(neutralRemarks);
        expect(result.listings[0]).not.toHaveProperty('remarksSha256');
        expect(result.listings[0]).not.toHaveProperty('fairHousingFlags');
        expect(result.remarksReviews).toEqual(expect.arrayContaining([
            expect.objectContaining({
                listingNumber: '73335000',
                action: 'remarks_suppressed',
                remarksSha256: createHash('sha256').update(flaggedRemarks[0], 'utf8').digest('hex'),
                fairHousingFlags: expect.arrayContaining([
                    expect.objectContaining({ code: 'familial_status_preference' }),
                    expect.objectContaining({ code: 'family_neighborhood_claim' }),
                ]),
            }),
            expect.objectContaining({
                listingNumber: '73335005',
                fairHousingFlags: expect.arrayContaining([
                    expect.objectContaining({ code: 'familial_status_preference' }),
                    expect.objectContaining({ code: 'family_friendly_claim' }),
                ]),
            }),
        ]));
    });

    it('suppresses explicit protected-class and source-of-income preferences without hiding neutral facts', () => {
        const flaggedExamples = [
            ['Adults only.', 'household_composition_preference'],
            ['Couples preferred.', 'household_composition_preference'],
            ['Singles only.', 'household_composition_preference'],
            ['Single person preferred.', 'household_composition_preference'],
            ['Single occupant only.', 'household_composition_preference'],
            ['No families.', 'household_composition_preference'],
            ['Families preferred.', 'household_composition_preference'],
            ['No children permitted.', 'children_reference'],
            ['Limited to one child.', 'children_reference'],
            ['No Section 8.', 'source_of_income_exclusion'],
            ['Housing vouchers not accepted.', 'source_of_income_exclusion'],
            ['Proof of employment is required.', 'source_of_income_exclusion'],
            ['No wheelchairs.', 'disability_exclusion'],
            ['Able-bodied only.', 'disability_exclusion'],
            ['Christians only.', 'religion_or_national_origin_preference'],
            ['U.S. citizens only.', 'religion_or_national_origin_preference'],
            ['English speakers preferred.', 'language_preference'],
            ['Ideal for students.', 'student_or_professional_preference'],
            ['Perfect for professionals.', 'student_or_professional_preference'],
            ['White applicants only.', 'race_color_ethnicity_or_ancestry_preference'],
            ['No Asian tenants.', 'race_color_ethnicity_or_ancestry_preference'],
            ['Hispanic buyers not accepted.', 'race_color_ethnicity_or_ancestry_preference'],
            ['Italian ancestry required.', 'race_color_ethnicity_or_ancestry_preference'],
            ['Women only.', 'sex_gender_or_orientation_preference'],
            ['Transgender applicants not accepted.', 'sex_gender_or_orientation_preference'],
            ['Gay couples preferred.', 'sex_gender_or_orientation_preference'],
            ['Gender identity required.', 'sex_gender_or_orientation_preference'],
            ['Married applicants only.', 'marital_status_preference'],
            ['No divorced tenants.', 'marital_status_preference'],
            ['Marital status required.', 'marital_status_preference'],
            ['Veterans preferred.', 'veteran_or_military_status_preference'],
            ['No active-duty service members.', 'veteran_or_military_status_preference'],
            ['Military status required.', 'veteran_or_military_status_preference'],
            ['Genetic screening required.', 'genetic_information_requirement_or_exclusion'],
            ['Applicants with a genetic condition not accepted.', 'genetic_information_requirement_or_exclusion'],
            ['Must provide genetic information.', 'genetic_information_requirement_or_exclusion'],
        ] as const;
        const allowedRemarks = [
            'A family room complements this single-family home near a multi-family property.',
            'BPDA income restrictions, asset limits, and buyer eligibility requirements apply.',
            'Section 8 approved unit that is currently Section 8 occupied.',
            'The entrance has a wheelchair-accessible ramp.',
            'Student housing is permitted by local zoning.',
            'Near St. Joseph Church, Italian restaurants, and professional offices.',
            'White oak cabinets, black appliances, and a warm color palette complete the kitchen.',
            "Historic records document the original owner's Italian ancestry.",
            'A women-owned contractor completed the renovation.',
            'The bath uses gender-neutral paint colors and universal design features.',
            'The married original owners carefully maintained the property.',
            'Renovated by a veteran-owned contractor near Veterans Memorial Park.',
            'The home is located on Military Road near the town center.',
            'A genetic testing laboratory operates in the nearby research district.',
            'No genetic information is included in this listing.',
        ];
        const remarks = [...flaggedExamples.map(([text]) => text), ...allowedRemarks];
        const result = cleanSalesRows({
            rows: remarks.map((text, index) => validSalesRow({
                LIST_NO: String(73336000 + index),
                REMARKS: text,
            })),
            propertyClass: 'single-family',
            references,
            optOutOfficeIds: new Set(),
            complianceConfig,
        });

        expect(result.report).toMatchObject({
            published: remarks.length,
            quarantined: 0,
            remarksSuppressed: flaggedExamples.length,
        });
        expect(result.quarantined).toEqual([]);
        flaggedExamples.forEach(([, code], index) => {
            expect(result.remarksReviews[index]).toMatchObject({
                listingNumber: String(73336000 + index),
                action: 'remarks_suppressed',
                fairHousingFlags: expect.arrayContaining([expect.objectContaining({ code })]),
            });
            expect(result.remarksReviews[index].remarksSha256).toMatch(/^[a-f0-9]{64}$/);
            expect(result.listings[index].remarks).toBe('');
        });
        expect(result.listings.slice(flaggedExamples.length).map((item) => item.remarks)).toEqual(allowedRemarks);
    });

    it('derives a compact search index and per-listing detail records', () => {
        const result = cleanSalesRows({
            rows: [{
                PROP_TYPE: 'SF',
                LIST_NO: '73333444',
                LIST_AGENT: 'BB904054',
                LIST_OFFICE: 'BB5984',
                STATUS: 'ACT',
                LIST_PRICE: '8990000',
                STREET_NO: '86',
                STREET_NAME: 'Mount Vernon Street',
                UNIT_NO: '',
                TOWN_NUM: '1',
                AREA: '102',
                ZIP_CODE: '02108',
                STATE: 'MA',
                REMARKS: 'Source-faithful public remarks.',
                PHOTO_COUNT: '2',
                NO_BEDROOMS: '5',
                NO_FULL_BATHS: '4',
                NO_HALF_BATHS: '2',
                SQUARE_FEET: '4492',
                COUNTY: 'Suffolk',
                LISTING_ALERT: 'N',
                STYLE: 'P',
                WATERFRONT_FLAG: 'N',
            }],
            propertyClass: 'single-family',
            references,
            optOutOfficeIds: new Set(),
            complianceConfig,
        });

        const mapPosition = {
            lat: 42.3588,
            lng: -71.0707,
            source: 'google_geocoding',
            precision: 'ROOFTOP',
            geocodedAt: '2026-06-20T12:00:00.000Z',
            expiresAt: '2026-07-20T12:00:00.000Z',
        };
        const outputs = buildPublicListingOutputs({
            generatedAt: '2026-06-29T12:00:00.000Z',
            now: Date.parse('2026-07-01T12:00:00.000Z'),
            source: 'MLS PIN Exchange',
            disclaimer: MLS_PIN_PUBLIC_DISCLAIMER,
            compliance: complianceConfig,
            sourceSnapshot: {
                capturedAt: '2026-06-29T12:00:00.000Z',
                latestSalesFileModifiedAt: '2026-06-29T11:45:00.000Z',
                salesFiles: [{
                    name: 'idx_sf.txt',
                    propertyClass: 'single-family',
                    modifiedAt: '2026-06-29T11:45:00.000Z',
                    sizeBytes: 2048,
                }],
            },
            listings: [{
                ...result.listings[0],
                mapPosition,
                openHouses: [
                    ...result.listings[0].openHouses,
                    {
                        start: '2026-06-29T09:00:00',
                        end: '2026-06-29T10:00:00',
                        type: 'In-Person',
                        url: '',
                    },
                ],
            }],
        });

        expect(outputs.searchIndexBundle.listings[0]).toEqual({
            listingNumber: '73333444',
            propertyType: 'Single family',
            status: {
                code: 'ACT',
                label: 'Active',
                isActive: true,
            },
            listPrice: 8990000,
            priceLabel: '$8,990,000',
            address: {
                line: '86 Mount Vernon Street',
                town: 'Boston',
                county: 'Suffolk',
                state: 'MA',
                zip: '02108',
            },
            facts: {
                beds: 5,
                fullBaths: 4,
                halfBaths: 2,
                bathsLabel: '',
                sqft: 4492,
            },
            photoCount: 2,
            openHouseCount: 1,
            openHouseEndTimes: ['2026-06-29T10:00:00'],
            hasVirtualTour: true,
            attribution: {
                listingAgent: 'Avery Agent',
                listingOffice: 'Beacon Office',
            },
            source: {
                name: 'MLS Property Information Network, Inc.',
            },
            mapPosition,
        });
        expect(outputs.searchIndexBundle.sourceSnapshot).toMatchObject({
            latestSalesFileModifiedAt: '2026-06-29T11:45:00.000Z',
            salesFiles: [expect.objectContaining({
                name: 'idx_sf.txt',
                propertyClass: 'single-family',
            })],
        });
        expect(outputs.detailRecords[0]).toMatchObject({
            fileName: '73333444.json',
            listing: {
                listingNumber: '73333444',
                photoCount: 2,
                status: {
                    isContingent: false,
                },
                address: {
                    area: 'Beacon Hill',
                    neighborhood: '',
                },
                facts: {
                    lotSize: null,
                    acreage: null,
                    yearBuilt: null,
                    parking: null,
                    rooms: null,
                    garageSpaces: null,
                    hasBasement: null,
                },
                remarks: 'Source-faithful public remarks.',
                openHouses: [{
                    start: '2026-06-29T09:00:00',
                    end: '2026-06-29T10:00:00',
                    type: 'In-Person',
                    url: '',
                }],
                virtualTourUrl: 'https://example.com/tour',
                attribution: {
                    listingOfficePhone: '617-555-0100',
                },
                source: {
                    photoDate: '',
                    listingAlert: 'N',
                },
                mapPosition,
            },
        });
        expect(outputs.detailRecords[0].listing).not.toHaveProperty('photos');
        expect(outputs.searchManifest).toMatchObject({
            schemaVersion: 1,
            totalListingCount: 1,
            coordinateIndex: {
                file: 'mls-coordinate-index.json',
                coordinateCount: 1,
            },
            shards: [
                { id: 'preferred', file: 'mls-search-preferred.json', listingCount: 1 },
                { id: 'other', file: 'mls-search-other.json', listingCount: 0 },
            ],
        });
        expect(outputs.searchShardRecords).toEqual([
            expect.objectContaining({
                id: 'preferred',
                fileName: 'mls-search-preferred.json',
                value: expect.objectContaining({
                    listings: [expect.not.objectContaining({ mapPosition: expect.anything() })],
                }),
            }),
            expect.objectContaining({
                id: 'other',
                fileName: 'mls-search-other.json',
                value: expect.objectContaining({ listings: [] }),
            }),
        ]);
        expect(outputs.coordinateIndex).toEqual({
            schemaVersion: 1,
            generatedAt: '2026-06-29T12:00:00.000Z',
            coordinates: {
                '73333444': {
                    lat: 42.3588,
                    lng: -71.0707,
                    expiresAt: '2026-07-20T12:00:00.000Z',
                },
            },
        });
        expect(outputs).not.toHaveProperty('legacyBundle');
    });

    it('partitions preferred Massachusetts towns from other reviewed listings', () => {
        const bostonListing = {
            listingNumber: '73333444',
            address: { town: 'Boston', state: 'MA' },
        };
        const nantucketListing = {
            listingNumber: '73333445',
            address: { town: 'Nantucket', state: 'MA' },
        };
        const delivery = buildMlsSearchDelivery({
            generatedAt: '2026-07-09T12:00:00.000Z',
            source: 'MLS PIN',
            disclaimer: MLS_PIN_PUBLIC_DISCLAIMER,
            compliance: complianceConfig,
            listings: [bostonListing, nantucketListing],
        });

        expect(delivery.manifest.totalListingCount).toBe(2);
        expect(delivery.shardRecords[0].value.listings).toEqual([bostonListing]);
        expect(delivery.shardRecords[1].value.listings).toEqual([nantucketListing]);
    });
});

describe('MLS JSON serialization', () => {
    it('minifies public JSON while keeping private review JSON readable', () => {
        const value = { listingCount: 2, warnings: ['missing_photos'] };

        expect(serializeMlsJson(value)).toBe('{"listingCount":2,"warnings":["missing_photos"]}\n');
        expect(serializeMlsJson(value, { pretty: true })).toBe([
            '{',
            '  "listingCount": 2,',
            '  "warnings": [',
            '    "missing_photos"',
            '  ]',
            '}',
            '',
        ].join('\n'));
    });
});
