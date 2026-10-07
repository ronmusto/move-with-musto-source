'use client';

import { FormEvent, useId, useState } from 'react';
import styles from './RealEstateComingSoon.module.css';

type UnsubscribeFormProps = {
    action?: string;
    contactEmail: string;
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

export function UnsubscribeForm({ action, contactEmail }: UnsubscribeFormProps) {
    const noteId = useId();
    const [submitState, setSubmitState] = useState<SubmitState>({
        kind: 'idle',
        message: '',
    });

    const isSubmitting = submitState.kind === 'submitting';

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!action) return;

        const form = event.currentTarget;
        const formData = new FormData(form);
        const email = readFormValue(formData, 'email');

        setSubmitState({
            kind: 'submitting',
            message: 'Sending your request...',
        });

        try {
            const response = await fetch(action, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    email,
                    source: 'move-with-musto-unsubscribe-page',
                }),
            });

            if (!response.ok) {
                throw new Error(`Unsubscribe endpoint returned ${response.status}`);
            }

            setSubmitState({
                kind: 'success',
                message:
                    'Your request was received. That address will not receive Move With Musto marketing emails.',
            });
            form.reset();
        } catch {
            setSubmitState({
                kind: 'error',
                message: `Something went wrong. Please email ${contactEmail} if this keeps happening.`,
            });
        }
    }

    return (
        <form
            aria-label="Unsubscribe from Move With Musto updates"
            aria-describedby={submitState.kind === 'idle' ? undefined : noteId}
            className={styles.signupForm}
            onSubmit={handleSubmit}
        >
            <label>
                <span>Email address</span>
                <input
                    autoComplete="email"
                    disabled={!action}
                    name="email"
                    placeholder="you@example.com"
                    required
                    type="email"
                />
            </label>
            <button disabled={!action || isSubmitting} type="submit">
                {isSubmitting ? 'Sending...' : 'Send'}
            </button>
            {!action ? (
                <p>
                    Online requests are unavailable. Please{' '}
                    <a className={styles.unsubscribeEmailLink} href={`mailto:${contactEmail}?subject=Unsubscribe`}>send an unsubscribe request by email</a>.
                </p>
            ) : null}
            {submitState.kind === 'idle' ? null : (
                <div
                    id={noteId}
                    className={`${styles.signupNote} ${statusClassNames[submitState.kind]}`}
                    role={submitState.kind === 'error' || submitState.kind === 'success' ? 'status' : undefined}
                >
                    {submitState.message}
                </div>
            )}
        </form>
    );
}
