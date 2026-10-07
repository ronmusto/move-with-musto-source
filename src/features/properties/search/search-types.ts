import { type SearchConsultLeadSearchContext } from '@/lib/lead-capture';
import { type MlsSearchListing } from '@/lib/mls-public-listings';
import { type PropertyViewMode } from '../property-search-utils';

export type LeadAction =
    | 'get_matching_homes'
    | 'request_details'
    | 'request_showing'
    | 'send_selected_homes'
    | 'ask_about_home';

export type SubmitState =
    | { kind: 'idle'; message: string }
    | { kind: 'submitting'; message: string }
    | { kind: 'success'; message: string }
    | { kind: 'error'; message: string };

export type ComparisonView = 'minimized' | 'tray' | 'full';

export type MobileSearchView = 'list' | 'map' | 'saved' | 'compare' | 'contact';

export type ResultPageSize = 10 | 50;

export type ResultsViewMode = Exclude<PropertyViewMode, 'map'>;

export type TownRuleState = 'included' | 'excluded';

export type ActiveFilterChip = Readonly<{
    key: string;
    label: string;
    onRemove: () => void;
}>;

export type LeadDrawerState = Readonly<{
    instanceId: number;
    action: LeadAction;
    listings: MlsSearchListing[];
    searchContext: SearchConsultLeadSearchContext;
}> | null;

export type PhotoGalleryState = Readonly<{
    listing: MlsSearchListing;
    initialIndex: number;
}> | null;
