import { areaImages } from './neighborhoods-data';

export type PropertyStatus = 'Buyer Note' | 'Seller Note' | 'Market Note';

export type PropertyImage = {
    src: string;
    alt: string;
    width: number;
    height: number;
};

export type PropertyMetric = {
    label: string;
    value: string;
};

export type Property = {
    slug: string;
    title: string;
    status: PropertyStatus;
    neighborhood: string;
    neighborhoodSlug: string;
    images: [PropertyImage, ...PropertyImage[]];
    summary: string;
    description: string;
    metrics: PropertyMetric[];
    highlights: string[];
    decisionPoints: string[];
    deliverables: string[];
};

export const properties: Property[] = [
    {
        slug: 'first-purchase-search-plan',
        title: 'First Purchase Search Plan',
        status: 'Buyer Note',
        neighborhood: 'Greater Boston',
        neighborhoodSlug: 'greater-boston',
        images: [areaImages.greaterBoston],
        summary: 'A practical way to define fit before listings start competing for attention.',
        description:
            'For buyers early in the process, online browsing becomes more useful with a focused search plan: monthly comfort, location tradeoffs, property condition, commute patterns, financing readiness, and the signals that make a showing worth scheduling.',
        metrics: [
            { label: 'Best for', value: 'Early buyers' },
            { label: 'Focus', value: 'Budget, location, fit' },
            { label: 'Outcome', value: 'Search plan' },
        ],
        highlights: [
            'Separate wants from durable needs before touring.',
            'Compare location tradeoffs with real daily-life constraints.',
            'Know what must be true before writing an offer.',
        ],
        decisionPoints: [
            'What monthly number leaves room for maintenance, savings, and normal life?',
            'Which neighborhoods make the commute, daily logistics, and resale picture work together?',
            'What property conditions are acceptable, and which create avoidable risk?',
            'What would make a home worth pursuing quickly instead of just saving online?',
        ],
        deliverables: [
            'A written search plan with budget, location, and property criteria.',
            'A first-pass neighborhood shortlist with tradeoffs made explicit.',
            'A showing filter so every tour answers the same practical questions.',
        ],
    },
    {
        slug: 'seller-readiness-walkthrough',
        title: 'Seller Readiness Walkthrough',
        status: 'Seller Note',
        neighborhood: 'North Shore',
        neighborhoodSlug: 'north-shore',
        images: [areaImages.northShore],
        summary: 'A room-by-room preparation plan before photography, pricing, and launch timing.',
        description:
            'A composed listing starts before the home is public. This walkthrough organizes condition, presentation, repairs, access, photography readiness, and the choices that can change buyer confidence without overbuilding the pre-listing checklist.',
        metrics: [
            { label: 'Best for', value: 'Future sellers' },
            { label: 'Focus', value: 'Prep and presentation' },
            { label: 'Outcome', value: 'Launch checklist' },
        ],
        highlights: [
            'Identify preparation that changes buyer perception.',
            'Prioritize the work that photographs and showings need most.',
            'Avoid spending energy on fixes that do not change the sale story.',
        ],
        decisionPoints: [
            'Which rooms need attention before buyers or a camera judge the home?',
            'What should be repaired, refreshed, cleaned up, or left alone?',
            'How should access, pets, storage, and daily routines be handled during showings?',
            'What preparation will improve confidence without overbuilding the checklist?',
        ],
        deliverables: [
            'A room-by-room preparation list organized by impact and urgency.',
            'A media-readiness plan for photography, showing flow, and first impressions.',
            'A launch sequence that connects prep, pricing, timing, and buyer access.',
        ],
    },
    {
        slug: 'pricing-position-review',
        title: 'Pricing Position Review',
        status: 'Seller Note',
        neighborhood: 'MetroWest',
        neighborhoodSlug: 'route-2-495',
        images: [areaImages.routeTwo],
        summary: 'A pricing conversation built around competition, timing, and seller goals.',
        description:
            'A useful price is not just a recent comparable sale. Pricing should reflect competing inventory, buyer alternatives, condition, days-on-market risk, and the seller outcome that matters most: certainty, flexibility, speed, or price.',
        metrics: [
            { label: 'Best for', value: 'Pre-listing strategy' },
            { label: 'Focus', value: 'Price and timing' },
            { label: 'Outcome', value: 'Positioning plan' },
        ],
        highlights: [
            'Read active competition as seriously as closed sales.',
            'Understand when price should create momentum.',
            'Clarify the tradeoff between speed, certainty, and leverage.',
        ],
        decisionPoints: [
            'Which active listings will buyers compare against this home first?',
            'What condition or location factors should change the price posture?',
            'Where does the seller need speed, certainty, flexibility, or maximum reach?',
            'What adjustment plan makes sense if the first market response is quiet?',
        ],
        deliverables: [
            'A pricing range framed against active competition and recent outcomes.',
            'A launch posture that explains where confidence and risk sit.',
            'A response plan for showing feedback, activity level, and offer timing.',
        ],
    },
    {
        slug: 'neighborhood-fit-map',
        title: 'Neighborhood Fit Map',
        status: 'Buyer Note',
        neighborhood: 'North of Boston',
        neighborhoodSlug: 'metro-north',
        images: [areaImages.metroNorth],
        summary: 'A guided comparison of daily logistics, commute, inventory, and resale signals.',
        description:
            'For buyers comparing several communities, it helps to organize what each area changes: commute rhythm, housing stock, maintenance profile, local conveniences, future resale flexibility, and how much compromise is worth the location.',
        metrics: [
            { label: 'Best for', value: 'Area comparison' },
            { label: 'Focus', value: 'Daily fit' },
            { label: 'Outcome', value: 'Shortlist' },
        ],
        highlights: [
            'Compare neighborhoods by lived tradeoffs, not just map distance.',
            'Connect property style with maintenance and resale expectations.',
            'Narrow the search without missing the reason behind each choice.',
        ],
        decisionPoints: [
            'Which areas change the daily routine in a way that matters?',
            'Where does the same budget buy space, condition, commute, or daily convenience?',
            'How should transit, water proximity, public services, or town centers be weighed?',
            'Which compromises are acceptable now and still sensible at resale?',
        ],
        deliverables: [
            'A ranked area shortlist with the why behind each community.',
            'A comparison of commute, housing stock, daily logistics, and resale considerations.',
            'A cleaner search map that keeps promising areas from becoming noise.',
        ],
    },
    {
        slug: 'offer-terms-review',
        title: 'Offer Terms Review',
        status: 'Buyer Note',
        neighborhood: 'Greater Boston',
        neighborhoodSlug: 'greater-boston',
        images: [areaImages.greaterBoston],
        summary: 'A clearer look at price, contingencies, timing, financing, and risk.',
        description:
            'When the right home appears, the offer has to be more than a number. Buyers should understand deposit structure, inspection posture, financing strength, timeline, seller priorities, and where conviction should stop before risk gets too high.',
        metrics: [
            { label: 'Best for', value: 'Offer readiness' },
            { label: 'Focus', value: 'Terms and risk' },
            { label: 'Outcome', value: 'Offer strategy' },
        ],
        highlights: [
            'Compare headline price with the terms that affect certainty.',
            'Prepare decision boundaries before competition creates pressure.',
            'Understand where an offer can be strong without becoming reckless.',
        ],
        decisionPoints: [
            'What is the real ceiling before emotion starts setting the number?',
            'Which terms improve certainty without crossing the buyer risk line?',
            'How do inspection, financing, deposit, and timeline choices change the offer?',
            'What seller priorities can be addressed without giving away too much?',
        ],
        deliverables: [
            'An offer posture that separates price, terms, timing, and risk.',
            'A decision boundary for escalation, concessions, and walking away.',
            'A clear explanation of what makes the offer strong or vulnerable.',
        ],
    },
    {
        slug: 'move-timing-checkup',
        title: 'Move Timing Checkup',
        status: 'Market Note',
        neighborhood: 'North Shore',
        neighborhoodSlug: 'north-shore',
        images: [areaImages.northShore],
        summary: 'A planning session for owners deciding whether to buy first, sell first, or wait.',
        description:
            'Some of the most important real estate decisions happen before there is a listing or showing. This checkup helps clients think through equity, timing, interim housing, financing, market pace, and what would make a move easier to execute.',
        metrics: [
            { label: 'Best for', value: 'Planning ahead' },
            { label: 'Focus', value: 'Timing and sequence' },
            { label: 'Outcome', value: 'Next-step plan' },
        ],
        highlights: [
            'Map what needs to happen before the public market clock starts.',
            'Think through buy-first and sell-first tradeoffs.',
            'Decide whether now, later, or a staged plan creates the best path.',
        ],
        decisionPoints: [
            'Does buying first, selling first, or waiting create the cleanest sequence?',
            'What has to be solved around equity, financing, interim housing, or storage?',
            'Which market conditions would make action easier or harder?',
            'What should be prepared now even if the move is months away?',
        ],
        deliverables: [
            'A timing map for the next move, including dependencies and pressure points.',
            'A buy-first versus sell-first comparison tied to financing and daily life.',
            'A practical next-step list for preparation, conversations, and watch items.',
        ],
    },
];

export function getPropertyBySlug(slug: string): Property | undefined {
    return properties.find((property) => property.slug === slug);
}

export function getAllPropertySlugs(): string[] {
    return properties.map((property) => property.slug);
}
