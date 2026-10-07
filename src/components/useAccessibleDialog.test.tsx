import { useRef, useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { useAccessibleDialog } from './useAccessibleDialog';

function TestDialog({
    label,
    onClose,
    children,
    inertBackground = true,
}: Readonly<{
    label: string;
    onClose: () => void;
    children?: React.ReactNode;
    inertBackground?: boolean;
}>) {
    const initialFocusRef = useRef<HTMLButtonElement>(null);
    const dialogRef = useAccessibleDialog<HTMLDivElement>({
        initialFocusRef,
        inertBackground,
        onClose,
    });

    return (
        <div aria-label={label} aria-modal="true" ref={dialogRef} role="dialog">
            <button ref={initialFocusRef} type="button">First action</button>
            {children}
            <button onClick={onClose} type="button">Close {label}</button>
        </div>
    );
}

function SingleDialogHarness({ inertBackground = true }: Readonly<{ inertBackground?: boolean }>) {
    const [open, setOpen] = useState(false);

    return (
        <>
            <button onClick={() => setOpen(true)} type="button">Open dialog</button>
            <main data-testid="background">
                <a href="#background-link">Background link</a>
            </main>
            {open ? (
                <TestDialog
                    inertBackground={inertBackground}
                    label="Example dialog"
                    onClose={() => setOpen(false)}
                />
            ) : null}
        </>
    );
}

function NestedDialogHarness() {
    const [parentOpen, setParentOpen] = useState(false);
    const [childOpen, setChildOpen] = useState(false);

    return (
        <>
            <button onClick={() => setParentOpen(true)} type="button">Open parent</button>
            {parentOpen ? (
                <TestDialog label="Parent dialog" onClose={() => setParentOpen(false)}>
                    <button onClick={() => setChildOpen(true)} type="button">Open child</button>
                    {childOpen ? (
                        <TestDialog label="Child dialog" onClose={() => setChildOpen(false)} />
                    ) : null}
                </TestDialog>
            ) : null}
        </>
    );
}

describe('useAccessibleDialog', () => {
    it('moves focus inside, traps Tab, closes with Escape, and restores trigger focus', async () => {
        const user = userEvent.setup();
        render(<SingleDialogHarness />);

        const trigger = screen.getByRole('button', { name: /open dialog/i });
        await user.click(trigger);

        const dialog = screen.getByRole('dialog', { name: /example dialog/i });
        const firstAction = screen.getByRole('button', { name: /first action/i });
        const closeAction = screen.getByRole('button', { name: /close example dialog/i });

        await waitFor(() => expect(firstAction).toHaveFocus());

        closeAction.focus();
        await user.tab();
        expect(firstAction).toHaveFocus();

        firstAction.focus();
        await user.tab({ shift: true });
        expect(closeAction).toHaveFocus();

        expect(dialog).toHaveAttribute('tabindex', '-1');
        await user.keyboard('{Escape}');

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        await waitFor(() => expect(trigger).toHaveFocus());
    });

    it('locks scrolling and restores existing overflow and inert state', async () => {
        const user = userEvent.setup();
        document.body.style.overflow = 'clip';
        document.body.style.paddingRight = '7px';
        const originalInnerWidth = window.innerWidth;
        const originalClientWidth = document.documentElement.clientWidth;
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 });
        Object.defineProperty(document.documentElement, 'clientWidth', {
            configurable: true,
            value: 1180,
        });
        render(<SingleDialogHarness />);

        const background = screen.getByTestId('background');
        background.setAttribute('inert', '');

        await user.click(screen.getByRole('button', { name: /open dialog/i }));

        expect(document.body.style.overflow).toBe('hidden');
        expect(document.body.style.paddingRight).toBe('27px');
        expect(background).toHaveAttribute('inert');

        await user.click(screen.getByRole('button', { name: /close example dialog/i }));

        expect(document.body.style.overflow).toBe('clip');
        expect(document.body.style.paddingRight).toBe('7px');
        expect(background).toHaveAttribute('inert');
        document.body.style.overflow = '';
        document.body.style.paddingRight = '';
        background.removeAttribute('inert');
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth });
        Object.defineProperty(document.documentElement, 'clientWidth', {
            configurable: true,
            value: originalClientWidth,
        });
    });

    it('allows background inerting to be disabled', async () => {
        const user = userEvent.setup();
        render(<SingleDialogHarness inertBackground={false} />);

        const background = screen.getByTestId('background');
        await user.click(screen.getByRole('button', { name: /open dialog/i }));

        expect(background).not.toHaveAttribute('inert');
    });

    it('keeps only the top dialog Escape-active and preserves the shared scroll lock', async () => {
        const user = userEvent.setup();
        render(<NestedDialogHarness />);

        const parentTrigger = screen.getByRole('button', { name: /open parent/i });
        await user.click(parentTrigger);
        const childTrigger = screen.getByRole('button', { name: /open child/i });
        await waitFor(() => expect(screen.getByRole('button', { name: /first action/i })).toHaveFocus());

        await user.click(childTrigger);
        expect(screen.getAllByRole('dialog')).toHaveLength(2);
        expect(document.body.style.overflow).toBe('hidden');

        await user.keyboard('{Escape}');

        expect(screen.queryByRole('dialog', { name: /child dialog/i })).not.toBeInTheDocument();
        expect(screen.getByRole('dialog', { name: /parent dialog/i })).toBeInTheDocument();
        expect(document.body.style.overflow).toBe('hidden');
        await waitFor(() => expect(childTrigger).toHaveFocus());

        await user.keyboard('{Escape}');

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(document.body.style.overflow).toBe('');
        await waitFor(() => expect(parentTrigger).toHaveFocus());
    });

    it('releases stacked locks and inert attributes when dialogs unmount together', async () => {
        const user = userEvent.setup();
        const { unmount } = render(<NestedDialogHarness />);

        await user.click(screen.getByRole('button', { name: /open parent/i }));
        await user.click(screen.getByRole('button', { name: /open child/i }));
        expect(document.body.style.overflow).toBe('hidden');

        unmount();

        expect(document.body.style.overflow).toBe('');
        expect(document.querySelectorAll('[inert]')).toHaveLength(0);
    });

    it('supports a caller-supplied dialog ref and close callback', async () => {
        const onClose = vi.fn();

        function SuppliedRefDialog() {
            const dialogRef = useRef<HTMLDivElement>(null);
            useAccessibleDialog({ dialogRef, inertBackground: false, onClose });

            return (
                <div aria-label="Supplied ref dialog" ref={dialogRef} role="dialog">
                    <button type="button">Action</button>
                </div>
            );
        }

        render(<SuppliedRefDialog />);
        await userEvent.keyboard('{Escape}');

        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
