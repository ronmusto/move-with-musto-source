'use client';

import { type RefObject, useEffect, useRef } from 'react';

const focusableSelector = [
    'a[href]',
    'button:not(:disabled)',
    'input:not(:disabled):not([type="hidden"])',
    'select:not(:disabled)',
    'textarea:not(:disabled)',
    'summary',
    'iframe',
    '[contenteditable="true"]',
    '[tabindex]:not([tabindex="-1"])',
].join(', ');

type DialogRegistration = {
    dialogRef: RefObject<HTMLElement | null>;
    restoreTargets: HTMLElement[];
};

type InertLock = {
    count: number;
    wasInert: boolean;
};

export type DialogBackgroundResolver = (
    dialog: HTMLElement,
) => Iterable<HTMLElement>;

export type UseAccessibleDialogOptions<T extends HTMLElement> = Readonly<{
    /** Keep this false when an overlay remains mounted but is visually closed. */
    active?: boolean;
    /** Close callback used for Escape dismissal. */
    onClose: () => void;
    /** Supply an existing container ref, or use the ref returned by the hook. */
    dialogRef?: RefObject<T | null>;
    /** Preferred initial-focus target. Falls back to autofocus, first focusable, then the container. */
    initialFocusRef?: RefObject<HTMLElement | null>;
    /** Disable only for non-modal surfaces that intentionally allow background scrolling. */
    lockBodyScroll?: boolean;
    /** Automatically inert background siblings, use a custom resolver, or disable inerting. */
    inertBackground?: boolean | DialogBackgroundResolver;
    closeOnEscape?: boolean;
    restoreFocus?: boolean;
}>;

const dialogStack: DialogRegistration[] = [];
const inertLocks = new Map<HTMLElement, InertLock>();
let bodyScrollLockCount = 0;
let bodyOverflowBeforeLock = '';
let bodyPaddingRightBeforeLock = '';

function isVisible(element: HTMLElement) {
    const style = window.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden';
}

function focusableElements(dialog: HTMLElement) {
    return Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector)).filter((element) => (
        isVisible(element) &&
        element.getAttribute('aria-hidden') !== 'true' &&
        !element.closest('[inert]')
    ));
}

function focusDialog(
    registration: DialogRegistration,
    initialFocusRef?: RefObject<HTMLElement | null>,
) {
    const dialog = registration.dialogRef.current;
    if (!dialog) {
        return;
    }

    const requestedTarget = initialFocusRef?.current;
    const autoFocusTarget = dialog.querySelector<HTMLElement>('[autofocus]');
    const target = requestedTarget && dialog.contains(requestedTarget)
        ? requestedTarget
        : autoFocusTarget ?? focusableElements(dialog)[0] ?? dialog;

    target.focus();
}

function collectBackgroundSiblings(dialog: HTMLElement) {
    const backgroundElements = new Set<HTMLElement>();
    let activeBranch: HTMLElement | null = dialog;

    while (activeBranch?.parentElement) {
        const parentElement: HTMLElement = activeBranch.parentElement;

        Array.from(parentElement.children).forEach((sibling) => {
            if (sibling !== activeBranch && sibling instanceof HTMLElement) {
                backgroundElements.add(sibling);
            }
        });

        if (parentElement === document.body) {
            break;
        }

        activeBranch = parentElement;
    }

    return backgroundElements;
}

function acquireInert(elements: Iterable<HTMLElement>, dialog: HTMLElement) {
    const acquired: HTMLElement[] = [];

    new Set(elements).forEach((element) => {
        if (
            element === dialog ||
            element.contains(dialog) ||
            dialog.contains(element)
        ) {
            return;
        }

        const existingLock = inertLocks.get(element);
        if (existingLock) {
            existingLock.count += 1;
        } else {
            inertLocks.set(element, {
                count: 1,
                wasInert: element.hasAttribute('inert'),
            });
            element.setAttribute('inert', '');
        }

        acquired.push(element);
    });

    return acquired;
}

function releaseInert(elements: Iterable<HTMLElement>) {
    new Set(elements).forEach((element) => {
        const lock = inertLocks.get(element);
        if (!lock) {
            return;
        }

        lock.count -= 1;
        if (lock.count > 0) {
            return;
        }

        if (!lock.wasInert) {
            element.removeAttribute('inert');
        }
        inertLocks.delete(element);
    });
}

function acquireBodyScrollLock() {
    if (bodyScrollLockCount === 0) {
        bodyOverflowBeforeLock = document.body.style.overflow;
        bodyPaddingRightBeforeLock = document.body.style.paddingRight;

        const scrollbarWidth = Math.max(
            0,
            window.innerWidth - document.documentElement.clientWidth,
        );
        if (scrollbarWidth > 0) {
            const computedPaddingRight = Number.parseFloat(
                window.getComputedStyle(document.body).paddingRight,
            ) || 0;
            document.body.style.paddingRight = `${computedPaddingRight + scrollbarWidth}px`;
        }
        document.body.style.overflow = 'hidden';
    }
    bodyScrollLockCount += 1;
}

function releaseBodyScrollLock() {
    bodyScrollLockCount = Math.max(0, bodyScrollLockCount - 1);
    if (bodyScrollLockCount === 0) {
        document.body.style.overflow = bodyOverflowBeforeLock;
        document.body.style.paddingRight = bodyPaddingRightBeforeLock;
        bodyOverflowBeforeLock = '';
        bodyPaddingRightBeforeLock = '';
    }
}

function isTopDialog(registration: DialogRegistration) {
    return dialogStack.at(-1) === registration;
}

function unregisterDialog(registration: DialogRegistration) {
    const index = dialogStack.indexOf(registration);
    if (index === -1) {
        return false;
    }

    const wasTopDialog = index === dialogStack.length - 1;

    if (!wasTopDialog && registration.restoreTargets.length > 0) {
        dialogStack.slice(index + 1).forEach((higherDialog) => {
            registration.restoreTargets.forEach((target) => {
                if (!higherDialog.restoreTargets.includes(target)) {
                    higherDialog.restoreTargets.push(target);
                }
            });
        });
    }

    dialogStack.splice(index, 1);
    return wasTopDialog;
}

function restoreFocusAfterClose(registration: DialogRegistration) {
    queueMicrotask(() => {
        const nextDialog = dialogStack.at(-1);

        if (nextDialog) {
            const nextContainer = nextDialog.dialogRef.current;
            const nestedTrigger = registration.restoreTargets.find((target) => (
                target.isConnected && nextContainer?.contains(target)
            ));

            if (nestedTrigger) {
                nestedTrigger.focus();
            } else {
                focusDialog(nextDialog);
            }
            return;
        }

        registration.restoreTargets.find((target) => target.isConnected)?.focus();
    });
}

/**
 * Adds modal keyboard, focus, scroll-lock, and optional inert-background behavior
 * to a conditionally rendered dialog container. The caller still owns semantic
 * attributes such as role="dialog", aria-modal, and an accessible name.
 */
export function useAccessibleDialog<T extends HTMLElement = HTMLElement>({
    active = true,
    onClose,
    dialogRef: suppliedDialogRef,
    initialFocusRef,
    lockBodyScroll = true,
    inertBackground = true,
    closeOnEscape = true,
    restoreFocus = true,
}: UseAccessibleDialogOptions<T>): RefObject<T | null> {
    const internalDialogRef = useRef<T>(null);
    const dialogRef = suppliedDialogRef ?? internalDialogRef;
    const onCloseRef = useRef(onClose);
    const inertBackgroundRef = useRef(inertBackground);
    const shouldInertBackground = Boolean(inertBackground);

    onCloseRef.current = onClose;
    inertBackgroundRef.current = inertBackground;

    useEffect(() => {
        if (!active) {
            return undefined;
        }

        const dialog = dialogRef.current;
        if (!dialog) {
            return undefined;
        }

        const trigger = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        const registration: DialogRegistration = {
            dialogRef: dialogRef as RefObject<HTMLElement | null>,
            restoreTargets: restoreFocus && trigger ? [trigger] : [],
        };
        const previousTabIndex = dialog.getAttribute('tabindex');
        const inertSetting = inertBackgroundRef.current;
        const backgroundElements = inertSetting
            ? acquireInert(
                typeof inertSetting === 'function'
                    ? inertSetting(dialog)
                    : collectBackgroundSiblings(dialog),
                dialog,
            )
            : [];
        let cancelled = false;

        if (previousTabIndex === null) {
            dialog.setAttribute('tabindex', '-1');
        }
        if (lockBodyScroll) {
            acquireBodyScrollLock();
        }
        dialogStack.push(registration);

        queueMicrotask(() => {
            if (!cancelled && isTopDialog(registration)) {
                focusDialog(registration, initialFocusRef);
            }
        });

        function handleKeyDown(event: KeyboardEvent) {
            if (!isTopDialog(registration) || event.defaultPrevented || event.isComposing) {
                return;
            }

            if (event.key === 'Escape' && closeOnEscape) {
                event.preventDefault();
                onCloseRef.current();
                return;
            }

            if (event.key !== 'Tab') {
                return;
            }

            const currentDialog = registration.dialogRef.current;
            if (!currentDialog) {
                return;
            }

            const items = focusableElements(currentDialog);
            const firstItem = items[0];
            const lastItem = items.at(-1);
            const activeElement = document.activeElement;

            if (!firstItem || !lastItem) {
                event.preventDefault();
                currentDialog.focus();
            } else if (!currentDialog.contains(activeElement)) {
                event.preventDefault();
                (event.shiftKey ? lastItem : firstItem).focus();
            } else if (event.shiftKey && (activeElement === firstItem || activeElement === currentDialog)) {
                event.preventDefault();
                lastItem.focus();
            } else if (!event.shiftKey && (activeElement === lastItem || activeElement === currentDialog)) {
                event.preventDefault();
                firstItem.focus();
            }
        }

        document.addEventListener('keydown', handleKeyDown);

        return () => {
            cancelled = true;
            document.removeEventListener('keydown', handleKeyDown);
            const wasTopDialog = unregisterDialog(registration);

            releaseInert(backgroundElements);
            if (lockBodyScroll) {
                releaseBodyScrollLock();
            }
            if (previousTabIndex === null) {
                dialog.removeAttribute('tabindex');
            }
            if (wasTopDialog && registration.restoreTargets.length > 0) {
                restoreFocusAfterClose(registration);
            }
        };
    }, [
        active,
        closeOnEscape,
        dialogRef,
        initialFocusRef,
        lockBodyScroll,
        shouldInertBackground,
        restoreFocus,
    ]);

    return dialogRef;
}
