'use client';

import { FormEvent, useEffect, useId, useRef, useState } from 'react';
import type { RealEstateContact, RealEstateInquiry } from '@/lib/real-estate-profile';
import styles from './LeadInquiryForm.module.css';

type LeadInquiryFormProps = {
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

export function LeadInquiryForm({
    contact,
    inquiry,
    privacyVersion,
    termsVersion,
}: LeadInquiryFormProps) {
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
    const directEmailHref = `mailto:${contact.email}?subject=${encodeURIComponent(
        'Move With Musto conversation',
    )}&body=${encodeURIComponent('Hi Mai Ly,\n\nI would like to talk through a move I am considering.')}`;
    const contactFormHref = '/contact/#contact-form';

    useEffect(() => {
        if (submitState.kind === 'success' || submitState.kind === 'error') {
            statusRef.current?.focus();
        }
    }, [submitState.kind]);

    if (!isConfigured) {
        return (
            <section
                aria-labelledby="homepage-direct-contact-title"
                className={styles.formUnavailable}
            >
                <p className={styles.unavailableEyebrow}>Direct contact</p>
                <h3 id="homepage-direct-contact-title">Reach out whenever you are ready.</h3>
                <p>
                    Email or call to share what you are considering, even if you are still
                    in the early stages.
                </p>
                <div className={styles.unavailableActions}>
                    <a href={contactFormHref}>
                        <strong>Get in touch</strong>
                        <span>Ask a question or tell Mai Ly how she can help.</span>
                    </a>
                </div>
                <p className={styles.directContactOptions}>
                    <strong>Prefer direct contact?</strong>
                    <a href={directEmailHref}>Email {contact.email}</a>
                    {contact.phone ? (
                        <a href={contact.phoneHref}>Call {contact.phone}</a>
                    ) : null}
                </p>
            </section>
        );
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
        const payload = {
            name: readFormValue(formData, 'name'),
            email: readFormValue(formData, 'email'),
            phone: readFormValue(formData, 'phone'),
            timeline: readFormValue(formData, 'timeline'),
            message: readFormValue(formData, 'message'),
            website: readFormValue(formData, 'website'),
            source: 'move-with-musto-homepage-inquiry',
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
                message: 'Thank you. Your message was sent.',
            });
        } catch {
            setSubmitState({
                kind: 'error',
                message: 'That did not go through. Please try again.',
            });
        }
    }

    return (
        <form
            ref={formRef}
            aria-label="Contact form about your move"
            aria-describedby={submitState.kind === 'idle' ? undefined : noteId}
            aria-busy={isSubmitting}
            className={styles.inquiryForm}
            onSubmit={handleSubmit}
        >
            <p className={styles.formRequirement}>Please complete the required fields.</p>
            <label>
                <span>Name (required)</span>
                <input autoComplete="name" name="name" placeholder="Your name" required type="text" />
            </label>
            <label>
                <span>Email (required)</span>
                <input
                    autoComplete="email"
                    name="email"
                    placeholder="you@example.com"
                    required
                    type="email"
                />
            </label>
            <label>
                <span>Phone (optional)</span>
                <input autoComplete="tel" name="phone" placeholder="Optional" type="tel" />
            </label>
            <label>
                <span>Timeline (optional)</span>
                <select name="timeline" defaultValue="">
                    <option value="" disabled>
                        Select one
                    </option>
                    <option value="buying-soon">Buying soon</option>
                    <option value="selling-soon">Selling soon</option>
                    <option value="planning-ahead">Planning ahead</option>
                    <option value="just-starting">Just starting the conversation</option>
                </select>
            </label>
            <label className={styles.messageField}>
                <span>Anything else you would like to share? (optional)</span>
                <textarea
                    name="message"
                    placeholder="Share any questions, priorities, or details that would be helpful."
                    rows={5}
                />
            </label>
            <div className={styles.consentRow}>
                <input
                    checked={termsAccepted}
                    id="inquiry-consent"
                    name="termsAccepted"
                    onChange={(event) => setTermsAccepted(event.currentTarget.checked)}
                    required
                    type="checkbox"
                />
                <label htmlFor="inquiry-consent">
                    (Required) I agree to the{' '}
                    <a aria-label="Terms (opens in a new tab)" href="/terms/" rel="noopener noreferrer" target="_blank">Terms</a>{' '}
                    and{' '}
                    <a aria-label="Privacy Policy (opens in a new tab)" href="/privacy/" rel="noopener noreferrer" target="_blank">Privacy Policy</a>{' '}
                    and consent to receive real-estate
                    follow-up from Move With Musto. I can unsubscribe at any time.
                </label>
            </div>
            <label aria-hidden="true" className={styles.honeypot}>
                <span>Website</span>
                <input autoComplete="off" name="website" tabIndex={-1} type="text" />
            </label>
            <button disabled={submitDisabled} type="submit">
                {isSubmitting ? (
                    <span className={styles.submitSpinner}>
                        <span className={styles.spinner} />
                        Sending...
                    </span>
                ) : (
                    submitState.kind === 'error' ? 'Try again' : 'Send message'
                )}
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
                        <> <a href={directEmailHref}>Email directly.</a></>
                    ) : null}
                </p>
            )}
        </form>
    );
}
