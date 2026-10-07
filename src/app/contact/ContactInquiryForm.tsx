'use client';

import { FormEvent, useEffect, useId, useRef, useState } from 'react';
import type { RealEstateContact, RealEstateInquiry } from '@/lib/real-estate-profile';
import styles from './ContactPage.module.css';

type ContactInquiryFormProps = {
    contact: RealEstateContact;
    inquiry: RealEstateInquiry;
    privacyVersion: string;
    termsVersion: string;
};

type SubmitState =
    | { kind: 'idle'; message: string }
    | { kind: 'submitting'; message: string }
    | { kind: 'success'; message: string }
    | { kind: 'error'; message: string };

const statusClassNames: Record<SubmitState['kind'], string> = {
    idle: '',
    submitting: '',
    success: styles.formStatusSuccess,
    error: styles.formStatusError,
};

function readFormValue(formData: FormData, key: string): string {
    const value = formData.get(key);
    return typeof value === 'string' ? value.trim() : '';
}

function buildMessage(propertyType: string, message: string): string {
    const propertyTypeLine = propertyType ? `Property type: ${propertyType}` : '';

    return [propertyTypeLine, message].filter(Boolean).join('\n\n');
}

const timelineOptions = [
    { value: 'as-soon-as-possible', label: 'As soon as possible' },
    { value: 'one-to-three-months', label: '1-3 months' },
    { value: 'three-to-six-months', label: '3-6 months' },
    { value: 'six-plus-months', label: '6+ months' },
    { value: 'not-sure-yet', label: 'Not sure yet' },
];

const propertyTypeOptions = [
    'Single-family home',
    'Condominium',
    'Townhouse',
    'Multifamily home',
    'Land',
    'Commercial property',
    'Other or not sure yet',
];

function buildDirectEmailHref(email: string): string {
    return `mailto:${email}?subject=${encodeURIComponent(
        'Real estate conversation',
    )}&body=${encodeURIComponent('Hi Mai Ly,\n\nI would like to talk through a real estate need I am considering.')}`;
}

function DirectContactActions({ contact }: { contact: RealEstateContact }) {
    return (
        <section aria-label="Direct contact options" className={styles.directContactActions}>
            {contact.phone ? (
                <a className={styles.directContactSecondaryAction} href={contact.phoneHref}>
                    <strong>Call Mai Ly</strong>
                    <span>{contact.phone}</span>
                </a>
            ) : null}
            <a href={buildDirectEmailHref(contact.email)}>
                <strong>Email Mai Ly</strong>
                <span>{contact.email}</span>
            </a>
        </section>
    );
}

export function ContactInquiryForm({
    contact,
    inquiry,
    privacyVersion,
    termsVersion,
}: ContactInquiryFormProps) {
    const noteId = useId();
    const formRef = useRef<HTMLFormElement>(null);
    const statusRef = useRef<HTMLParagraphElement>(null);
    const [termsAccepted, setTermsAccepted] = useState(false);
    const [submitState, setSubmitState] = useState<SubmitState>({
        kind: 'idle',
        message: '',
    });

    const isConfigured = Boolean(inquiry.action);
    const isSubmitting = submitState.kind === 'submitting';
    const submitDisabled = isSubmitting;
    const directEmailHref = buildDirectEmailHref(contact.email);

    useEffect(() => {
        if (submitState.kind === 'success' || submitState.kind === 'error') {
            statusRef.current?.focus();
        }
    }, [submitState.kind]);

    if (!isConfigured) {
        return <DirectContactActions contact={contact} />;
    }

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();

        if (!termsAccepted) {
            setSubmitState({
                kind: 'error',
                message: 'Please agree to the Terms and Privacy Policy before sending your inquiry.',
            });
            return;
        }

        if (!inquiry.action) {
            setSubmitState({
                kind: 'error',
                message: 'Email is the direct contact option for this page.',
            });
            return;
        }

        const formData = new FormData(event.currentTarget);
        const firstName = readFormValue(formData, 'firstName');
        const lastName = readFormValue(formData, 'lastName');
        const propertyType = readFormValue(formData, 'primaryGoal');
        const payload = {
            name: [firstName, lastName].filter(Boolean).join(' '),
            email: readFormValue(formData, 'email'),
            phone: readFormValue(formData, 'phone'),
            timeline: readFormValue(formData, 'timeline'),
            primaryGoal: propertyType,
            message: buildMessage(propertyType, readFormValue(formData, 'message')),
            website: readFormValue(formData, 'website'),
            source: 'move-with-musto-contact-inquiry',
            termsAccepted: true,
            privacyAccepted: true,
            termsVersion,
            privacyVersion,
        };

        setSubmitState({
            kind: 'submitting',
            message: 'Sending your note...',
        });

        try {
            const requestMethod = inquiry.method === 'get' ? 'GET' : 'POST';
            const endpoint = new URL(inquiry.action, window.location.origin);
            const requestInit: RequestInit = {
                method: requestMethod,
            };

            if (requestMethod === 'GET') {
                Object.entries(payload).forEach(([key, value]) => {
                    if (value) {
                        endpoint.searchParams.set(key, String(value));
                    }
                });
            } else {
                requestInit.headers = {
                    'Content-Type': 'application/json',
                };
                requestInit.body = JSON.stringify(payload);
            }

            const response = await fetch(endpoint, requestInit);

            if (!response.ok) {
                throw new Error(`Form endpoint returned ${response.status}`);
            }

            formRef.current?.reset();
            setTermsAccepted(false);
            setSubmitState({
                kind: 'success',
                message: 'Thank you. Your message was sent, and you will hear back soon.',
            });
        } catch {
            setSubmitState({
                kind: 'error',
                message: 'That did not go through. Please try again.',
            });
        }
    }

    return (
        <>
            <DirectContactActions contact={contact} />
            <form
                ref={formRef}
                aria-label="Real estate contact form"
                aria-describedby={submitState.kind === 'idle' ? undefined : noteId}
                aria-busy={isSubmitting}
                className={styles.inquiryForm}
                onSubmit={handleSubmit}
            >
            <p className={styles.formRequirement}>Fields marked required help us reply.</p>
            <div className={styles.nameGrid}>
                <label>
                    <span>First name (required)</span>
                    <input autoComplete="given-name" name="firstName" required type="text" />
                </label>
                <label>
                    <span>Last name (required)</span>
                    <input autoComplete="family-name" name="lastName" required type="text" />
                </label>
            </div>

            <label>
                <span>Email address (required)</span>
                <input autoComplete="email" name="email" required type="email" />
            </label>

            <label>
                <span>Phone number (optional)</span>
                <input autoComplete="tel" name="phone" type="tel" />
            </label>

            <div className={styles.selectionGrid}>
                <label>
                    <span className={styles.selectionLabel}>Property type (optional)</span>
                    <div className={styles.selectControl}>
                        <select name="primaryGoal" defaultValue="">
                            <option value="" disabled>
                                Choose a property type
                            </option>
                            {propertyTypeOptions.map((option) => (
                                <option key={option} value={option}>{option}</option>
                            ))}
                        </select>
                    </div>
                </label>

                <label>
                    <span className={styles.selectionLabel}>What timeline are you considering? (optional)</span>
                    <div className={styles.selectControl}>
                        <select name="timeline" defaultValue="">
                            <option value="" disabled>
                                Choose a timeframe
                            </option>
                            {timelineOptions.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </select>
                    </div>
                </label>
            </div>

            <label>
                <span>What would you like to share? (optional)</span>
                <textarea
                    name="message"
                    placeholder="Share any questions, priorities, or details that would be helpful."
                    rows={5}
                />
            </label>

            <div className={styles.consentRow}>
                <input
                    checked={termsAccepted}
                    id="contact-consent"
                    name="termsAccepted"
                    onChange={(event) => setTermsAccepted(event.currentTarget.checked)}
                    required
                    type="checkbox"
                />
                <label htmlFor="contact-consent">
                    (Required) I agree to the{' '}
                    <a aria-label="Terms (opens in a new tab)" href="/terms/" rel="noopener noreferrer" target="_blank">Terms</a>{' '}
                    and{' '}
                    <a aria-label="Privacy Policy (opens in a new tab)" href="/privacy/" rel="noopener noreferrer" target="_blank">Privacy Policy</a>{' '}
                    and consent to receive real estate
                    follow-up from Move With Musto.
                </label>
            </div>

            <label aria-hidden="true" className={styles.honeypot}>
                <span>Website</span>
                <input autoComplete="off" name="website" tabIndex={-1} type="text" />
            </label>

            <button disabled={submitDisabled} type="submit">
                {isSubmitting ? 'Sending...' : submitState.kind === 'error' ? 'Try again' : 'Send message'}
            </button>

            {submitState.kind === 'idle' ? null : (
                <p
                    ref={statusRef}
                    id={noteId}
                    className={`${styles.formNote} ${statusClassNames[submitState.kind]}`}
                    role={submitState.kind === 'error' ? 'alert' : 'status'}
                    tabIndex={-1}
                >
                    {submitState.message}
                    {submitState.kind === 'error'
                    && (submitState.message.startsWith('That')
                        || submitState.message.startsWith('Email is')) ? (
                        <> <a href={directEmailHref}>Send an email directly.</a></>
                    ) : null}
                </p>
            )}
            </form>
        </>
    );
}
