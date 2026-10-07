'use client';

import { useAccessibleDialog } from '@/components/useAccessibleDialog';
import {
    buildSearchConsultLeadPayload,
    type SearchConsultLeadFilters,
    type SearchConsultLeadSearchContext,
} from '@/lib/lead-capture';
import { type MlsSearchIndexBundle, type MlsSearchListing } from '@/lib/mls-public-listings';
import type { RealEstateContact, RealEstateCta, RealEstateInquiry } from '@/lib/real-estate-profile';
import { FormEvent, useEffect, useRef, useState } from 'react';
import styles from '../PropertiesSearch.module.css';
import {
    type PropertyFilterState,
    type PropertySortState,
    type PropertyViewMode,
} from '../property-search-utils';
import { MlsScreenDisclosure } from './CompliancePanel';
import { formatBaths, formatNumber, listingTitle } from './search-formatting';
import { actionLabels, propertyRequestOptions } from './search-options';
import { LeadAction, SubmitState } from './search-types';

function defaultLeadRequestType(action: LeadAction, listingCount: number): LeadAction {
    if (
        action === 'get_matching_homes' ||
        action === 'request_showing' ||
        action === 'send_selected_homes'
    ) {
        return action;
    }

    return listingCount > 0 ? 'request_details' : action;
}

function readFormValue(formData: FormData, key: string): string {
    const value = formData.get(key);
    return typeof value === 'string' ? value.trim() : '';
}

export function leadFilterSnapshot(
    filters: PropertyFilterState,
    mode: PropertyViewMode,
    sort: PropertySortState,
): SearchConsultLeadFilters {
    return {
        query: filters.query,
        state: filters.state,
        region: filters.region,
        county: filters.county,
        includeTowns: [...filters.includeTowns],
        excludeTowns: [...filters.excludeTowns],
        propertyType: filters.propertyType,
        minPrice: filters.minPrice,
        maxPrice: filters.maxPrice,
        minBeds: filters.minBeds,
        maxBeds: filters.maxBeds,
        minBaths: filters.minBaths,
        maxBaths: filters.maxBaths,
        openHouseOnly: filters.openHouseOnly,
        virtualTourOnly: filters.virtualTourOnly,
        savedOnly: filters.savedOnly,
        sortBy: sort.key,
        sortDirection: sort.direction,
        mode,
    };
}

function propertyLeadEndpoint(action: string | undefined) {
    if (!action) {
        return undefined;
    }

    if (action.includes('/property-leads') || action.includes('/inquiries')) {
        return action;
    }

    return action
        .replace(/\/newsletter\/subscribe\/?$/, '/property-leads');
}

function propertyLeadEmailHref(
    email: string,
    action: LeadAction,
    listings: readonly MlsSearchListing[],
    sourcePage: string,
) {
    const subject = action === 'send_selected_homes'
        ? `${listings.length} ${listings.length === 1 ? 'home' : 'homes'} to review`
        : listings.length === 1
            ? `${actionLabels[action]}: ${listingTitle(listings[0])}`
            : actionLabels[action];
    const listingLines = listings.length > 0
        ? listings.map((listing) => {
            const listingUrl = typeof window === 'undefined'
                ? `${sourcePage}?listing=${encodeURIComponent(listing.listingNumber)}`
                : (() => {
                    const url = new URL(sourcePage, window.location.origin);
                    url.searchParams.set('listing', listing.listingNumber);
                    return url.href;
                })();
            return [
                `- ${listingTitle(listing)}`,
                `  ${listing.priceLabel} · MLS #${listing.listingNumber}`,
                `  ${listingUrl}`,
            ].join('\n');
        }).join('\n')
        : '- No specific property selected yet';
    const body = [
        'Hi Mai Ly,',
        '',
        action === 'send_selected_homes'
            ? 'I would like to share these homes for your review.'
            : `I would like help with: ${actionLabels[action].toLowerCase()}.`,
        '',
        listings.length === 1 ? 'Home:' : 'Homes:',
        listingLines,
        '',
        'The best way to reach me is:',
        '',
    ].join('\n');

    return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function AttachedHomesSummary({
    backLabel,
    listings,
    onRemove,
    onReturnToListings,
}: Readonly<{
    backLabel: string;
    listings: MlsSearchListing[];
    onRemove: (listingNumber: string) => void;
    onReturnToListings: () => void;
}>) {
    const backButtonRef = useRef<HTMLButtonElement>(null);
    const removeButtonRefs = useRef(new Map<string, HTMLButtonElement>());
    const homeCount = listings.length;

    function removeListing(listingNumber: string, index: number) {
        const focusListing = listings[index + 1] ?? listings[index - 1];
        onRemove(listingNumber);
        window.requestAnimationFrame(() => {
            const nextFocusTarget = focusListing
                ? removeButtonRefs.current.get(focusListing.listingNumber)
                : backButtonRef.current;
            nextFocusTarget?.focus({ preventScroll: true });
        });
    }

    return (
        <section aria-label="Homes included in this request" className={styles.attachedHomes}>
            <span aria-live="polite">
                {homeCount === 0
                    ? 'No homes included'
                    : homeCount === 1
                        ? 'Home included'
                        : `${homeCount} homes included`}
            </span>
            {homeCount === 0 ? (
                <p className={styles.attachedHomesEmpty}>
                    You can still send a general question or return to your homes to make changes.
                </p>
            ) : null}
            {listings.map((listing, index) => (
                <article className={styles.attachedHomeCard} key={listing.listingNumber}>
                    <div className={styles.attachedHomeHeader}>
                        <p>{listingTitle(listing)} · MLS #{listing.listingNumber}</p>
                        <button
                            aria-label={`Remove ${listingTitle(listing)} from this request`}
                            className={styles.attachedHomeRemove}
                            onClick={() => removeListing(listing.listingNumber, index)}
                            ref={(button) => {
                                if (button) {
                                    removeButtonRefs.current.set(listing.listingNumber, button);
                                } else {
                                    removeButtonRefs.current.delete(listing.listingNumber);
                                }
                            }}
                            title="Remove from this request"
                            type="button"
                        >
                            <span aria-hidden="true" className={styles.trashIcon} />
                        </button>
                    </div>
                    <dl>
                        <div><dt>Price</dt><dd>{listing.priceLabel}</dd></div>
                        <div><dt>Beds</dt><dd>{formatNumber(listing.facts.beds)}</dd></div>
                        <div><dt>Baths</dt><dd>{formatBaths(listing.facts)}</dd></div>
                        <div><dt>Sqft</dt><dd>{formatNumber(listing.facts.sqft)}</dd></div>
                        <div><dt>Status</dt><dd>{listing.status.label}</dd></div>
                        <div><dt>Type</dt><dd>{listing.propertyType}</dd></div>
                    </dl>
                    <p className={styles.attachedHomeAttribution}>
                        Listed by {listing.attribution.listingAgent}, {listing.attribution.listingOffice}
                    </p>
                </article>
            ))}
            <button
                className={styles.attachedHomesBack}
                onClick={onReturnToListings}
                ref={backButtonRef}
                type="button"
            >
                {backLabel}
            </button>
        </section>
    );
}

export function LeadDrawer({
    action,
    appointmentCta,
    backLabel,
    bundle,
    listings,
    contact,
    inquiry,
    privacyVersion,
    searchContext,
    sourcePage,
    termsVersion,
    onClose,
    onReturnToListings,
    onStartAnother,
}: Readonly<{
    action: LeadAction;
    appointmentCta?: RealEstateCta;
    backLabel: string;
    bundle: MlsSearchIndexBundle | null;
    listings: MlsSearchListing[];
    contact: RealEstateContact;
    inquiry: RealEstateInquiry;
    privacyVersion: string;
    searchContext: SearchConsultLeadSearchContext;
    sourcePage: string;
    termsVersion: string;
    onClose: () => void;
    onReturnToListings: () => void;
    onStartAnother: () => void;
}>) {
    const dialogRef = useAccessibleDialog<HTMLElement>({ onClose });
    const formRef = useRef<HTMLFormElement>(null);
    const phoneRef = useRef<HTMLInputElement>(null);
    const successPanelRef = useRef<HTMLDivElement>(null);
    const [includedListings, setIncludedListings] = useState(listings);
    const [termsAccepted, setTermsAccepted] = useState(false);
    const [submitState, setSubmitState] = useState<SubmitState>({ kind: 'idle', message: '' });
    const [selectedRequestType, setSelectedRequestType] = useState<LeadAction>(
        defaultLeadRequestType(action, listings.length),
    );
    const [preferredContact, setPreferredContact] = useState<'email' | 'phone'>('email');
    const isShowingRequest = selectedRequestType === 'request_showing';
    const isPhoneRequired = isShowingRequest || preferredContact === 'phone';
    const endpoint = propertyLeadEndpoint(inquiry.action);
    const isSubmitting = submitState.kind === 'submitting';
    const title = actionLabels[action];
    const fallbackEmailHref = propertyLeadEmailHref(contact.email, action, includedListings, sourcePage);
    const homeCount = includedListings.length;
    const homeNoun = homeCount === 1 ? 'home' : 'homes';
    const isCollectionEmail = action === 'send_selected_homes' && homeCount > 0;
    const hadAttachedHomes = listings.length > 0;
    const fallbackHeading = homeCount > 0
        ? isCollectionEmail
            ? `Review ${homeCount} ${homeNoun}, then open your email.`
            : homeCount === 1
                ? 'Email this home directly.'
                : `Email these ${homeCount} homes directly.`
        : 'Start with a direct email.';
    const fallbackDescription = homeCount > 0
        ? `The email is ready with ${homeCount === 1 ? 'the home' : `all ${homeCount} homes`} below, including ${homeCount === 1 ? 'its' : 'each'} address, price, MLS number, and detail link.`
        : 'Email or call to share what you are considering and choose a comfortable next step.';
    const appointmentLinkProps = appointmentCta && /^https?:\/\//i.test(appointmentCta.href)
        ? { rel: 'noreferrer', target: '_blank' }
        : {};

    useEffect(() => {
        setSelectedRequestType(defaultLeadRequestType(action, listings.length));
    }, [action, listings.length]);

    useEffect(() => {
        if (submitState.kind === 'success') {
            window.requestAnimationFrame(() => successPanelRef.current?.focus({ preventScroll: true }));
        }
    }, [submitState.kind]);

    function removeIncludedListing(listingNumber: string) {
        const nextListings = includedListings.filter((listing) => listing.listingNumber !== listingNumber);
        setIncludedListings(nextListings);
        if (nextListings.length === 0 && selectedRequestType === 'send_selected_homes') {
            setSelectedRequestType('get_matching_homes');
        }
    }

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();

        if (!termsAccepted) {
            setSubmitState({
                kind: 'error',
                message: 'Please agree to the Terms and Privacy Policy before sending.',
            });
            return;
        }

        const formData = new FormData(event.currentTarget);
        const phone = readFormValue(formData, 'phone');
        if (isPhoneRequired && !phone) {
            setSubmitState({
                kind: 'error',
                message: preferredContact === 'phone'
                    ? 'Please add a phone number for a phone reply.'
                    : 'Please add a phone number to coordinate the showing.',
            });
            phoneRef.current?.focus();
            return;
        }

        if (!endpoint) {
            setSubmitState({
                kind: 'error',
                message: 'Please use the prepared email or call directly.',
            });
            return;
        }

        const attachedListings = includedListings.map((listing) => ({
            listingNumber: listing.listingNumber,
            title: listingTitle(listing),
            town: listing.address.town,
            status: listing.status.code,
            priceLabel: listing.priceLabel,
            detailUrl: (() => {
                const url = new URL(sourcePage, window.location.origin);
                url.searchParams.set('listing', listing.listingNumber);
                return url.href;
            })(),
        }));
        const originalAttachedNumbers = new Set(listings.map((listing) => listing.listingNumber));
        const requestSearchContext = {
            ...searchContext,
            selectedMlsNumbers: [
                ...searchContext.selectedMlsNumbers.filter((listingNumber) => (
                    !originalAttachedNumbers.has(listingNumber)
                )),
                ...includedListings.map((listing) => listing.listingNumber),
            ],
        };
        const payload = buildSearchConsultLeadPayload({
            requestType: selectedRequestType,
            contact: {
                name: readFormValue(formData, 'name'),
                email: readFormValue(formData, 'email'),
                phone,
                preferredContact,
            },
            freeformMessage: readFormValue(formData, 'message'),
            propertyLink: readFormValue(formData, 'propertyLink'),
            sourcePage,
            searchContext: requestSearchContext,
            attachedListings,
            website: readFormValue(formData, 'website'),
            consent: {
                termsAccepted: true,
                privacyAccepted: true,
                contactAuthorized: termsAccepted,
                emailUpdatesOptIn: formData.get('emailUpdatesOptIn') === 'on',
                termsVersion,
                privacyVersion,
            },
        });

        setSubmitState({ kind: 'submitting', message: 'Sending your note...' });

        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            if (!response.ok) {
                throw new Error(`Property lead endpoint returned ${response.status}`);
            }

            formRef.current?.reset();
            setTermsAccepted(false);
            setSubmitState({
                kind: 'success',
                message: 'Thanks—your request was sent. You will hear back personally.',
            });
        } catch {
            setSubmitState({
                kind: 'error',
                message: `We could not send this just now. You can email directly at ${contact.email}.`,
            });
        }
    }

    return (
        <div className={styles.drawerBackdrop}>
            <aside
                aria-label={title}
                aria-modal="true"
                className={styles.leadDrawer}
                ref={dialogRef}
                role="dialog"
            >
                <div className={styles.drawerHeader}>
                    <div>
                        <p className={styles.eyebrow}>Your request</p>
                        <h3>{title}</h3>
                    </div>
                    <button type="button" onClick={onClose}>Close</button>
                </div>

                {submitState.kind === 'success' ? (
                    <div className={styles.successPanel} ref={successPanelRef} role="status" tabIndex={-1}>
                        <p>{submitState.message}</p>
                        <div className={styles.successActions}>
                            <button type="button" onClick={onClose}>Keep searching</button>
                            <button type="button" onClick={onStartAnother}>Ask about something else</button>
                        </div>
                    </div>
                ) : !endpoint ? (
                    <div className={styles.drawerFallback}>
                        {hadAttachedHomes ? (
                            <AttachedHomesSummary
                                backLabel={backLabel}
                                listings={includedListings}
                                onRemove={removeIncludedListing}
                                onReturnToListings={onReturnToListings}
                            />
                        ) : null}
                        <div>
                            <p className={styles.eyebrow}>{isCollectionEmail ? 'Share your homes' : 'Direct contact'}</p>
                            <h4>{fallbackHeading}</h4>
                            <p>{fallbackDescription}</p>
                        </div>
                        {appointmentCta && !isCollectionEmail ? (
                            <a
                                className={styles.drawerBookingCta}
                                href={appointmentCta.href}
                                {...appointmentLinkProps}
                            >
                                {appointmentCta.label}
                            </a>
                        ) : null}
                        <div className={styles.drawerFallbackActions}>
                            <a className={styles.drawerFallbackPrimary} href={fallbackEmailHref}>
                                {homeCount > 0 ? `Open email with ${homeCount} ${homeNoun}` : 'Open email'}
                            </a>
                            {contact.phone ? (
                                <a className={styles.drawerFallbackSecondary} href={contact.phoneHref}>
                                    Call instead {contact.phone}
                                </a>
                            ) : null}
                        </div>
                        {includedListings.length > 0 && bundle ? (
                            <div className={styles.drawerDisclosurePanel}>
                                <MlsScreenDisclosure bundle={bundle} />
                            </div>
                        ) : null}
                    </div>
                ) : (
                    <form ref={formRef} className={styles.drawerForm} onSubmit={handleSubmit}>
                        <p className={styles.formNote}>Please complete the required fields.</p>
                        {hadAttachedHomes ? (
                            <AttachedHomesSummary
                                backLabel={backLabel}
                                listings={includedListings}
                                onRemove={removeIncludedListing}
                                onReturnToListings={onReturnToListings}
                            />
                        ) : null}

                        {appointmentCta ? (
                            <a
                                className={styles.drawerBookingCta}
                                href={appointmentCta.href}
                                {...appointmentLinkProps}
                            >
                                {appointmentCta.label}
                            </a>
                        ) : null}

                        {includedListings.length > 0 && !isCollectionEmail ? (
                            <label>
                                <span>What would you like help with? (required)</span>
                                <select
                                    aria-label="What would you like help with?"
                                    name="requestType"
                                    onChange={(event) => setSelectedRequestType(event.currentTarget.value as LeadAction)}
                                    value={selectedRequestType}
                                >
                                    {propertyRequestOptions.map((option) => (
                                        <option key={option.value} value={option.value}>
                                            {option.label}
                                        </option>
                                    ))}
                                </select>
                            </label>
                        ) : isCollectionEmail ? (
                            <input name="requestType" type="hidden" value="send_selected_homes" />
                        ) : null}

                        <label>
                            <span>Name (required)</span>
                            <input aria-label="Name" autoComplete="name" name="name" required />
                        </label>
                        <label>
                            <span>Email (required)</span>
                            <input aria-label="Email" autoComplete="email" name="email" required type="email" />
                        </label>
                        <label>
                            <span>Phone {isPhoneRequired ? '(required)' : '(optional)'}</span>
                            <input
                                autoComplete="tel"
                                name="phone"
                                ref={phoneRef}
                                required={isPhoneRequired}
                                type="tel"
                            />
                        </label>
                        <label>
                            <span>Preferred contact (required)</span>
                            <select
                                aria-label="Preferred contact"
                                name="preferredContact"
                                onChange={(event) => setPreferredContact(event.currentTarget.value as 'email' | 'phone')}
                                value={preferredContact}
                            >
                                <option value="email">Email</option>
                                <option value="phone">Phone</option>
                            </select>
                        </label>
                        <label>
                            <span>Property address or Move With Musto listing link (optional)</span>
                            <input
                                aria-label="Property address or Move With Musto listing link"
                                name="propertyLink"
                                placeholder="Enter an address or paste a link from this site"
                            />
                        </label>
                        <label>
                            <span>Message (optional)</span>
                            <textarea
                                aria-label="Message"
                                name="message"
                                placeholder="Share timing, questions, or showing availability."
                                rows={5}
                            />
                        </label>

                        <div className={styles.consentStack}>
                            <div className={styles.consentRow}>
                                <input
                                    checked={termsAccepted}
                                    id="property-terms-consent"
                                    onChange={(event) => setTermsAccepted(event.currentTarget.checked)}
                                    required
                                    type="checkbox"
                                />
                                <label htmlFor="property-terms-consent">
                                    <strong>Required.</strong>{' '}I agree to the <a href="/terms/" rel="noreferrer" target="_blank">Terms</a> and{' '}
                                    <a href="/privacy/" rel="noreferrer" target="_blank">Privacy Policy</a>, including email or phone follow-up
                                    about this property request.
                                </label>
                            </div>

                            <div className={styles.consentRow}>
                                <input id="email-updates" name="emailUpdatesOptIn" type="checkbox" />
                                <label htmlFor="email-updates">
                                    Optional: send me property matches and occasional market updates by email.
                                </label>
                            </div>
                        </div>

                        <label className={styles.honeypot}>
                            <span>Website</span>
                            <input autoComplete="off" name="website" tabIndex={-1} type="text" />
                        </label>

                        <button disabled={isSubmitting} type="submit">
                            {isSubmitting ? 'Sending...' : 'Send request'}
                        </button>

                        {submitState.kind === 'idle' ? null : (
                            <p className={submitState.kind === 'error' ? styles.formStatusError : styles.formNote} role="status">
                                {submitState.message}
                            </p>
                        )}

                        {includedListings.length > 0 && bundle ? (
                            <div className={styles.drawerDisclosurePanel}>
                                <MlsScreenDisclosure bundle={bundle} />
                            </div>
                        ) : null}
                    </form>
                )}
            </aside>
        </div>
    );
}
