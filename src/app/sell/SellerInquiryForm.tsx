'use client';

import { FormEvent, useEffect, useId, useRef, useState } from 'react';
import type { RealEstateContact, RealEstateInquiry } from '@/lib/real-estate-profile';
import styles from './sell-page.module.css';

type SellerInquiryFormProps = {
    contact: RealEstateContact;
    inquiry: RealEstateInquiry;
    privacyVersion: string;
    termsVersion: string;
};

type SubmitState = 'idle' | 'submitting' | 'success' | 'error';

function readFormValue(formData: FormData, key: string): string {
    const value = formData.get(key);
    return typeof value === 'string' ? value.trim() : '';
}

export function SellerInquiryForm({
    contact,
    inquiry,
    privacyVersion,
    termsVersion,
}: Readonly<SellerInquiryFormProps>) {
    const statusId = useId();
    const formRef = useRef<HTMLFormElement>(null);
    const statusRef = useRef<HTMLParagraphElement>(null);
    const [submitState, setSubmitState] = useState<SubmitState>('idle');
    const [statusMessage, setStatusMessage] = useState('');
    const action = inquiry.action;

    useEffect(() => {
        if (submitState === 'success' || submitState === 'error') {
            statusRef.current?.focus();
        }
    }, [submitState]);

    const directEmailHref = `mailto:${contact.email}?subject=${encodeURIComponent(
        'A home sale I am considering',
    )}&body=${encodeURIComponent(
        'Hi Mai Ly,\n\nI am thinking about selling and would like to talk through my options.',
    )}`;

    if (!action) {
        return (
            <section aria-labelledby="seller-direct-contact-title" className={styles.intakeUnavailable}>
                <p className={styles.unavailableEyebrow}>Get in touch</p>
                <h3 id="seller-direct-contact-title">Share what you are considering.</h3>
                <p>Email or call whenever it is convenient. A brief conversation is enough to get started.</p>
                <div className={styles.directContactActions}>
                    <a href={directEmailHref}>
                        <strong>Send an email</strong>
                        <span>{contact.email}</span>
                    </a>
                    {contact.phone ? (
                        <a className={styles.directContactSecondaryAction} href={contact.phoneHref}>
                            <strong>Call</strong>
                            <span>{contact.phone}</span>
                        </a>
                    ) : null}
                </div>
            </section>
        );
    }

    const configuredAction = action;

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();

        const formData = new FormData(event.currentTarget);
        const payload = {
            name: [readFormValue(formData, 'firstName'), readFormValue(formData, 'lastName')]
                .filter(Boolean)
                .join(' '),
            email: readFormValue(formData, 'email'),
            phone: readFormValue(formData, 'phone'),
            propertyAddress: readFormValue(formData, 'propertyAddress'),
            timeline: readFormValue(formData, 'timeline'),
            sellerPriority: readFormValue(formData, 'sellerPriority'),
            message: readFormValue(formData, 'message'),
            website: readFormValue(formData, 'website'),
            source: 'move-with-musto-seller-consultation',
            termsAccepted: true,
            privacyAccepted: true,
            privacyVersion,
            termsVersion,
        };

        setSubmitState('submitting');
        setStatusMessage('Sending your note...');

        try {
            const endpoint = new URL(configuredAction, window.location.origin);
            const method = inquiry.method === 'get' ? 'GET' : 'POST';
            const request: RequestInit = { method };

            if (method === 'GET') {
                Object.entries(payload).forEach(([key, value]) => {
                    if (value) endpoint.searchParams.set(key, String(value));
                });
            } else {
                request.headers = { 'Content-Type': 'application/json' };
                request.body = JSON.stringify(payload);
            }

            const response = await fetch(endpoint, request);
            if (!response.ok) throw new Error(`Seller inquiry returned ${response.status}`);

            formRef.current?.reset();
            setSubmitState('success');
            setStatusMessage('Thank you. Your message was sent, and you will receive a personal reply.');
        } catch {
            setSubmitState('error');
            setStatusMessage('That did not go through. Please try again.');
        }
    }

    const isSubmitting = submitState === 'submitting';

    return (
        <form
            ref={formRef}
            aria-busy={isSubmitting}
            aria-describedby={submitState === 'idle' ? undefined : statusId}
            aria-label="Seller conversation form"
            className={styles.form}
            onSubmit={handleSubmit}
        >
            <div className={styles.intakeHeader}>
                <span>A few details to get started</span>
                <p>Share what you know now. You will receive a personal reply.</p>
            </div>
            <div className={styles.formGrid}>
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
                <span>Property address or town (optional)</span>
                <input autoComplete="street-address" name="propertyAddress" type="text" />
            </label>
            <div className={styles.formGrid}>
                <label>
                    <span>Email address (required)</span>
                    <input autoComplete="email" name="email" required type="email" />
                </label>
                <label>
                    <span>Phone (optional)</span>
                    <input autoComplete="tel" name="phone" type="tel" />
                </label>
            </div>
            <div className={styles.formGrid}>
                <label>
                    <span>Timeline (optional)</span>
                    <select defaultValue="" name="timeline">
                        <option value="">Select one</option>
                        <option value="0-3-months">0-3 months</option>
                        <option value="3-6-months">3-6 months</option>
                        <option value="6-plus-months">6+ months</option>
                        <option value="planning">Just planning</option>
                    </select>
                </label>
                <label>
                    <span>What matters most right now? (optional)</span>
                    <select defaultValue="" name="sellerPriority">
                        <option value="">Select one</option>
                        <option value="price">Sale price</option>
                        <option value="speed">A quicker timeline</option>
                        <option value="certainty">A dependable closing</option>
                        <option value="flexibility">Flexible timing</option>
                    </select>
                </label>
            </div>
            <label>
                <span>Anything else you would like to share? (optional)</span>
                <textarea name="message" rows={5} />
            </label>
            <label className={styles.consentRow}>
                <input name="termsAccepted" required type="checkbox" value="true" />
                <span>
                    I agree to the{' '}
                    <LinkOut href="/terms/" label="Terms" /> and{' '}
                    <LinkOut href="/privacy/" label="Privacy Policy" />.
                </span>
            </label>
            <label aria-hidden="true" className={styles.honeypot}>
                <span>Website</span>
                <input autoComplete="off" name="website" tabIndex={-1} type="text" />
            </label>
            <button disabled={isSubmitting} type="submit">
                {isSubmitting ? 'Sending...' : submitState === 'error' ? 'Try again' : 'Send message'}
            </button>
            {submitState === 'idle' ? null : (
                <p
                    ref={statusRef}
                    className={`${styles.formStatus} ${submitState === 'error' ? styles.formStatusError : ''}`}
                    id={statusId}
                    role={submitState === 'error' ? 'alert' : 'status'}
                    tabIndex={-1}
                >
                    {statusMessage}{' '}
                    {submitState === 'error' ? <a href={directEmailHref}>Email directly.</a> : null}
                </p>
            )}
        </form>
    );
}

function LinkOut({ href, label }: Readonly<{ href: string; label: string }>) {
    return (
        <a aria-label={`${label} (opens in a new tab)`} href={href} rel="noopener noreferrer" target="_blank">
            {label}
        </a>
    );
}
