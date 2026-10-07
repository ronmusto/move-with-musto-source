import { marketRegions } from './market-regions';

export type Neighborhood = {
    slug: string;
    name: string;
    description: string;
    highlights: readonly string[];
    walkability: string;
    vibe: string;
    guideLabel: string;
    towns: readonly string[];
    image: {
        src: string;
        alt: string;
        width: number;
        height: number;
    };
    featuredCommunities: ReadonlyArray<{
        name: string;
        description: string;
        signal: string;
    }>;
};

type NeighborhoodPresentation = Omit<Neighborhood, 'slug' | 'name' | 'towns'>;

export const areaImages = {
    massachusettsDaytime: {
        src: '/images/areas/massachusetts-daytime-hero.webp',
        alt: 'Daytime Massachusetts harbor neighborhood with shingle homes, hydrangeas, and water views',
        width: 1847,
        height: 851,
    },
    northShore: {
        src: '/images/areas/north-shore-harbor-village.webp',
        alt: 'North Shore harbor village with classic homes and coastal water views',
        width: 1586,
        height: 992,
    },
    greaterBoston: {
        src: '/images/areas/greater-boston-brownstones.webp',
        alt: 'Greater Boston brownstone block with leafy sidewalks and skyline context',
        width: 1586,
        height: 992,
    },
    metroWest: {
        src: '/images/areas/metrowest-leafy-neighborhood.webp',
        alt: 'Tree-lined Massachusetts neighborhood with spacious classic homes',
        width: 1586,
        height: 992,
    },
    southShore: {
        src: '/images/areas/south-shore-harbor-homes.webp',
        alt: 'South of Boston harbor homes overlooking sailboats and coastal water',
        width: 1586,
        height: 992,
    },
    merrimackValley: {
        src: '/images/areas/massachusetts-daytime-hero.webp',
        alt: 'Daytime Massachusetts neighborhood representing Merrimack Valley communities',
        width: 1847,
        height: 851,
    },
    metroNorth: {
        src: '/images/areas/massachusetts-daytime-hero.webp',
        alt: 'Burlington-area neighborhood with classic homes and regional road connections',
        width: 1847,
        height: 851,
    },
    greaterLowell: {
        src: '/images/areas/metrowest-leafy-neighborhood.webp',
        alt: 'Tree-lined Greater Lowell and Nashoba neighborhood with classic homes',
        width: 1586,
        height: 992,
    },
    routeTwo: {
        src: '/images/areas/metrowest-leafy-neighborhood.webp',
        alt: 'Tree-lined Route 2 and MetroWest neighborhood with spacious classic homes',
        width: 1586,
        height: 992,
    },
} as const;

const neighborhoodPresentationBySlug: Record<string, NeighborhoodPresentation> = {
    'greater-boston': {
        description:
            'Explore Boston and connected inner-ring communities, with choices ranging from condos and multifamily homes to neighborhood single-family streets.',
        highlights: ['Urban and inner-ring inventory', 'Transit connections', 'Distinct property types'],
        walkability: 'Transit and block dependent',
        vibe: 'Urban, connected, varied',
        guideLabel: 'Urban Access',
        image: areaImages.greaterBoston,
        featuredCommunities: [
            {
                name: 'Boston, Cambridge & Somerville',
                description:
                    'Explore condominiums, single-family homes, and multifamily properties across neighborhoods with many different transit connections.',
                signal: 'City inventory',
            },
            {
                name: 'Arlington, Belmont, Brookline & Watertown',
                description:
                    'Connected residential communities with distinct streets, home layouts, town centers, and routes into Boston.',
                signal: 'Inner-ring access',
            },
            {
                name: 'Chelsea, Everett, Malden, Medford, Newton, Revere & Winthrop',
                description:
                    'A broad set of city and residential options with town-specific inventory and varied connections into Boston.',
                signal: 'Housing variety',
            },
        ],
    },
    'metro-north': {
        description:
            'Burlington and nearby Route 128 and I-93 communities offer a range of home styles, town centers, and everyday connections.',
        highlights: ['Burlington anchor', 'Route 128 and I-93 access', 'Town-specific inventory'],
        walkability: 'Center and transit dependent',
        vibe: 'Connected, established, practical',
        guideLabel: 'Burlington Area',
        image: areaImages.metroNorth,
        featuredCommunities: [
            {
                name: 'Burlington, Bedford, Lexington & Waltham',
                description:
                    'Route 128 communities with varied homes, established neighborhoods, and convenient connections for everyday travel.',
                signal: 'Route 128 core',
            },
            {
                name: 'Woburn, Winchester, Stoneham & Melrose',
                description:
                    'Closely connected communities with distinct housing stock and different combinations of rail, highway, and local access.',
                signal: 'Connected suburbs',
            },
            {
                name: 'Reading, North Reading, Wakefield & Wilmington',
                description:
                    'Northern suburbs offering different combinations of I-93 access, commuter rail, lot sizes, and home styles.',
                signal: 'Northern routes',
            },
        ],
    },
    'greater-lowell-nashoba': {
        description:
            'Explore city, suburban, and lower-density settings across Greater Lowell and the Nashoba Valley, connected by Routes 2, 3, and I-495.',
        highlights: ['Routes 2 and 3', 'I-495 connections', 'Varied lot and home types'],
        walkability: 'Town-center dependent',
        vibe: 'Regional, varied, lower-density',
        guideLabel: 'Lowell & Nashoba',
        image: areaImages.greaterLowell,
        featuredCommunities: [
            {
                name: 'Lowell, Billerica, Chelmsford & Tewksbury',
                description:
                    'A mix of city, suburban, and residential inventory centered on Routes 3 and 495 and the Lowell employment corridor.',
                signal: 'Greater Lowell core',
            },
            {
                name: 'Westford, Littleton, Carlisle, Dunstable, Tyngsborough & Dracut',
                description:
                    'Lower-density communities with room to explore larger lots, varied homes, and routes that fit your daily routine.',
                signal: 'Space and access',
            },
            {
                name: 'Ayer, Groton, Harvard, Pepperell, Shirley & Townsend',
                description:
                    'Nashoba Valley communities with room to explore larger lots, distinctive homes, and quieter settings alongside everyday travel needs.',
                signal: 'Extended Nashoba area',
            },
        ],
    },
    'merrimack-valley': {
        description:
            'From the I-93 corridor to river and coastal communities, the Lower Merrimack Valley offers varied homes, town centers, and settings.',
        highlights: ['I-93 and I-495 access', 'River and coastal cities', 'Varied property types'],
        walkability: 'Town-center focused',
        vibe: 'Connected, varied, established',
        guideLabel: 'River & Corridor',
        image: areaImages.merrimackValley,
        featuredCommunities: [
            {
                name: 'Andover, North Andover, Lawrence & Methuen',
                description:
                    'Closely connected communities with I-93 access and a broad mix of housing types, neighborhoods, and town centers.',
                signal: 'I-93 corridor',
            },
            {
                name: 'Haverhill, Groveland, Georgetown & Boxford',
                description:
                    'City, town-center, and lower-density options tied together by Route 97 and I-495 connections.',
                signal: 'Valley connections',
            },
            {
                name: 'Amesbury, Merrimac, Salisbury, Newbury, Newburyport & West Newbury',
                description:
                    'River and coastal communities with historic centers, varied home settings, and seasonal rhythms of their own.',
                signal: 'River and coast',
            },
        ],
    },
    'north-shore': {
        description:
            'Historic town centers, coastal settings, and inland neighborhoods give the North Shore a wide range of places to explore.',
        highlights: ['Coastal access', 'Historic centers', 'Commuter options'],
        walkability: 'Village-by-village',
        vibe: 'Coastal, varied, established',
        guideLabel: 'Coastal Living',
        image: areaImages.northShore,
        featuredCommunities: [
            {
                name: 'Saugus, Lynn, Lynnfield & Peabody',
                description:
                    'Southern North Shore communities with direct regional routes and a broad mix of neighborhoods and property types.',
                signal: 'Southern North Shore',
            },
            {
                name: 'Danvers, Salem, Beverly, Marblehead, Swampscott, Nahant & Middleton',
                description:
                    'Coastal and inland communities with distinct settings, harbor access, town centers, and regional road connections.',
                signal: 'Harbor and inland options',
            },
            {
                name: 'Topsfield, Wenham, Hamilton, Ipswich, Rowley, Essex, Manchester, Gloucester & Rockport',
                description:
                    'North Shore and Cape Ann communities with coastal character, varied lot sizes, and a wide range of home styles and settings.',
                signal: 'North Shore edge',
            },
        ],
    },
    'route-2-495': {
        description:
            'Route 2 and MetroWest bring together tree-lined town centers, varied home styles, and more spacious residential settings.',
        highlights: ['Route 2 corridor', 'MetroWest connections', 'Varied lots and layouts'],
        walkability: 'Center dependent',
        vibe: 'Western, varied, connected',
        guideLabel: 'Route 2 & MetroWest',
        image: areaImages.routeTwo,
        featuredCommunities: [
            {
                name: 'Acton, Concord, Lincoln & Maynard',
                description:
                    'Route 2 communities with homes from many eras, varied lot sizes, local centers, and different road connections.',
                signal: 'Route 2 core',
            },
            {
                name: 'Sudbury, Wayland, Weston, Wellesley, Natick & Framingham',
                description:
                    'MetroWest communities with varied town centers, road connections, and home layouts to explore around your daily routine.',
                signal: 'MetroWest access',
            },
            {
                name: 'Boxborough, Stow, Bolton, Hudson, Marlborough, Ashland, Dover, Sherborn & Needham',
                description:
                    'Western and southwestern communities offering a mix of space, established neighborhoods, and convenient town centers.',
                signal: 'Extended western area',
            },
        ],
    },
    'south-shore': {
        description:
            'Explore communities south of Boston and around Route 128, with city access, suburban neighborhoods, and established coastal settings.',
        highlights: ['Southern Route 128', 'City and suburban homes', 'Coastal communities'],
        walkability: 'Center and transit dependent',
        vibe: 'Southern, varied, connected',
        guideLabel: 'South of Boston',
        image: areaImages.southShore,
        featuredCommunities: [
            {
                name: 'Dedham, Milton, Norwood & Westwood',
                description:
                    'Southern Route 128 communities with varied lots, home styles, town centers, and convenient routes toward Boston.',
                signal: 'Route 128 arc',
            },
            {
                name: 'Quincy, Braintree, Randolph & Canton',
                description:
                    'A mix of transit, highway, and residential options across communities with their own neighborhoods and home styles.',
                signal: 'South of Boston access',
            },
            {
                name: 'Weymouth, Hingham & Cohasset',
                description:
                    'Established coastal communities with distinctive centers, varied homes, and settings close to the water.',
                signal: 'Coastal edge',
            },
        ],
    },
};

export const neighborhoods: Neighborhood[] = marketRegions.map((region) => {
    const presentation = neighborhoodPresentationBySlug[region.slug];

    if (!presentation) {
        throw new Error(`Missing neighborhood presentation for ${region.slug}.`);
    }

    return {
        slug: region.slug,
        name: region.name,
        towns: region.towns,
        ...presentation,
    };
});

export function getNeighborhoodBySlug(slug: string): Neighborhood | undefined {
    return neighborhoods.find((neighborhood) => neighborhood.slug === slug);
}
