'use client';

import { FormEvent, useId, useRef, useState } from 'react';
import type { ComingSoonSignupMethod } from '@/lib/coming-soon-config';
import styles from './RealEstateComingSoon.module.css';

type LaunchWaitlistFormProps = {
    action?: string;
    contactEmail: string;
    method: ComingSoonSignupMethod;
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
    success: styles.signupNoteSuccess,
    error: styles.signupNoteError,
};

function readFormValue(formData: FormData, key: string): string {
    const value = formData.get(key);
    return typeof value === 'string' ? value.trim() : '';
}

export function LaunchWaitlistForm({
    action,
    contactEmail,
    method,
    privacyVersion,
    termsVersion,
}: LaunchWaitlistFormProps) {
    const noteId = useId();
    const formRef = useRef<HTMLFormElement>(null);
    const [termsAccepted, setTermsAccepted] = useState(false);
    const [submitState, setSubmitState] = useState<SubmitState>({
        kind: 'idle',
        message: '',
    });

    const isConfigured = Boolean(action);
    const isSubmitting = submitState.kind === 'submitting';
    const submitDisabled = !isConfigured || isSubmitting || !termsAccepted;

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();

        if (!termsAccepted) {
            setSubmitState({
                kind: 'error',
                message: 'Please agree to the Terms and Privacy Policy before joining the list.',
            });
            return;
        }

        if (!action) {
            setSubmitState({
                kind: 'error',
                message: 'Newsletter signup is unavailable right now. Please try again later.',
            });
            return;
        }

        const formData = new FormData(event.currentTarget);
        const payload = {
            name: readFormValue(formData, 'name'),
            email: readFormValue(formData, 'email'),
            phone: readFormValue(formData, 'phone'),
            message: readFormValue(formData, 'message'),
            website: readFormValue(formData, 'website'),
            source: 'move-with-musto-coming-soon',
            termsAccepted: true,
            privacyAccepted: true,
            termsVersion,
            privacyVersion,
        };

        setSubmitState({
            kind: 'submitting',
            message: 'Adding you to the list...',
        });

        try {
            const requestMethod = method === 'get' ? 'GET' : 'POST';
            const endpoint = new URL(action);
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
                message: 'Thank you. You are on the Move With Musto launch list.',
            });
        } catch {
            setSubmitState({
                kind: 'error',
                message: `Something went wrong. Please email ${contactEmail} if this keeps happening.`,
            });
        }
    }

    return (
        <form
            ref={formRef}
            aria-label="Launch waitlist"
            aria-describedby={submitState.kind === 'idle' ? undefined : noteId}
            className={styles.signupForm}
            onSubmit={handleSubmit}
        >
            <label>
                <span>Name</span>
                <input autoComplete="name" name="name" placeholder="Your name" type="text" />
            </label>
            <label>
                <span>Email</span>
                <input
                    autoComplete="email"
                    name="email"
                    placeholder="you@example.com"
                    required
                    type="email"
                />
            </label>
            <label>
                <span>Phone</span>
                <input autoComplete="tel" name="phone" placeholder="Optional" type="tel" />
            </label>
            <label>
                <span>Message</span>
                <textarea
                    name="message"
                    placeholder="Tell us what you would like updates about."
                    rows={3}
                />
            </label>
            <div className={styles.consentRow}>
                <input
                    checked={termsAccepted}
                    id="newsletter-consent"
                    name="termsAccepted"
                    onChange={(event) => setTermsAccepted(event.currentTarget.checked)}
                    required
                    type="checkbox"
                />
                <label htmlFor="newsletter-consent">
                    I agree to the{' '}
                    <a href="/terms/">Terms</a>
                    {' '}and{' '}
                    <a href="/privacy/">Privacy Policy</a>
                    {' '}and consent to receive Move With Musto launch updates and
                    occasional real-estate guidance. I can unsubscribe at any time.
                </label>
            </div>
            <label className={styles.honeypot}>
                <span>Website</span>
                <input
                    autoComplete="off"
                    name="website"
                    tabIndex={-1}
                    type="text"
                />
            </label>
            <button disabled={submitDisabled} type="submit">
                {isSubmitting ? 'Joining...' : 'Join the newsletter'}
            </button>
            {submitState.kind === 'idle' ? null : (
                <div
                    id={noteId}
                    className={`${styles.signupNote} ${statusClassNames[submitState.kind]}`}
                    role={submitState.kind === 'error' || submitState.kind === 'success' ? 'status' : undefined}
                >
                    <span>{submitState.message}</span>
                </div>
            )}
        </form>
    );
}
