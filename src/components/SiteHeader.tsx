'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { isCommercialPublic } from '@/lib/commercial-visibility';
import type { RealEstateProfile } from '@/lib/real-estate-profile';
import styles from './SiteHeader.module.css';

type SiteHeaderProps = {
    profile: RealEstateProfile;
};

const publicNavLinks = [
    { label: 'About', href: '/about/' },
    { label: 'Buy', href: '/buy/properties/' },
    { label: 'Sell', href: '/sell/' },
    { label: 'Contact', href: '/contact/' },
];

const commercialNavLink = { label: 'Commercial', href: '/commercial/' };

const SCROLL_THRESHOLD_PX = 40;

export function SiteHeader({ profile }: SiteHeaderProps) {
    const pathname = usePathname();
    const navLinks = isCommercialPublic()
        ? [...publicNavLinks.slice(0, 3), commercialNavLink, ...publicNavLinks.slice(3)]
        : publicNavLinks;
    const [scrolled, setScrolled] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const scrollSentinelRef = useRef<HTMLSpanElement>(null);
    const headerRef = useRef<HTMLElement>(null);
    const menuToggleRef = useRef<HTMLButtonElement>(null);
    const mobileNavRef = useRef<HTMLElement>(null);
    const previouslyFocusedRef = useRef<HTMLElement | null>(null);

    useEffect(() => {
        const sentinel = scrollSentinelRef.current;

        if (sentinel && typeof window.IntersectionObserver === 'function') {
            const observer = new window.IntersectionObserver(([entry]) => {
                if (entry) {
                    setScrolled(!entry.isIntersecting);
                }
            });

            observer.observe(sentinel);
            return () => observer.disconnect();
        }

        let animationFrame: number | null = null;
        let lastScrolled = false;

        const updateScrolledState = () => {
            animationFrame = null;
            const next = window.scrollY > SCROLL_THRESHOLD_PX;

            if (next !== lastScrolled) {
                lastScrolled = next;
                setScrolled(next);
            }
        };
        const scheduleUpdate = () => {
            if (animationFrame === null) {
                animationFrame = window.requestAnimationFrame(updateScrolledState);
            }
        };

        updateScrolledState();
        window.addEventListener('scroll', scheduleUpdate, { passive: true });

        return () => {
            window.removeEventListener('scroll', scheduleUpdate);
            if (animationFrame !== null) {
                window.cancelAnimationFrame(animationFrame);
            }
        };
    }, []);

    const closeMenu = useCallback(() => {
        (previouslyFocusedRef.current ?? menuToggleRef.current)?.focus();
        setMenuOpen(false);
    }, []);

    function toggleMenu() {
        if (menuOpen) {
            closeMenu();
            return;
        }

        previouslyFocusedRef.current = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : menuToggleRef.current;
        setMenuOpen(true);
    }

    /* Isolate the open menu, move focus into it, and retain keyboard focus there. */
    useEffect(() => {
        if (!menuOpen) {
            return undefined;
        }

        const previousOverflow = document.body.style.overflow;
        const previousPaddingRight = document.body.style.paddingRight;
        const scrollbarWidth = Math.max(
            0,
            window.innerWidth - document.documentElement.clientWidth,
        );
        const header = headerRef.current;
        const backgroundElements = Array.from(document.body.children)
            .filter((element): element is HTMLElement => (
                element instanceof HTMLElement && element !== header
            ))
            .map((element) => ({
                element,
                wasInert: element.hasAttribute('inert'),
            }));
        const focusFrame = window.requestAnimationFrame(() => {
            mobileNavRef.current?.querySelector<HTMLElement>('a[href]')?.focus();
        });
        const navItems = mobileNavRef.current
            ? Array.from(mobileNavRef.current.querySelectorAll<HTMLElement>(
                'a[href], button:not(:disabled), [tabindex]:not([tabindex="-1"])',
            ))
            : [];
        const focusableItems = [menuToggleRef.current, ...navItems]
            .filter((item): item is HTMLElement => Boolean(item));

        function handleKeyDown(event: KeyboardEvent) {
            if (event.key === 'Escape') {
                event.preventDefault();
                closeMenu();
                return;
            }

            if (event.key !== 'Tab') {
                return;
            }

            const firstItem = focusableItems[0];
            const lastItem = focusableItems.at(-1);
            const activeElement = document.activeElement;

            if (!firstItem || !lastItem) {
                return;
            }

            if (!focusableItems.includes(activeElement as HTMLElement)) {
                event.preventDefault();
                firstItem.focus();
            } else if (event.shiftKey && activeElement === firstItem) {
                event.preventDefault();
                lastItem.focus();
            } else if (!event.shiftKey && activeElement === lastItem) {
                event.preventDefault();
                firstItem.focus();
            }
        }

        if (scrollbarWidth > 0) {
            const computedPaddingRight = Number.parseFloat(
                window.getComputedStyle(document.body).paddingRight,
            ) || 0;
            document.body.style.paddingRight = `${computedPaddingRight + scrollbarWidth}px`;
        }
        document.body.style.overflow = 'hidden';
        backgroundElements.forEach(({ element }) => element.setAttribute('inert', ''));
        document.addEventListener('keydown', handleKeyDown);

        return () => {
            window.cancelAnimationFrame(focusFrame);
            document.removeEventListener('keydown', handleKeyDown);
            document.body.style.overflow = previousOverflow;
            document.body.style.paddingRight = previousPaddingRight;
            backgroundElements.forEach(({ element, wasInert }) => {
                if (!wasInert) {
                    element.removeAttribute('inert');
                }
            });
        };
    }, [closeMenu, menuOpen]);

    /* Close the mobile drawer if the viewport switches back to desktop. */
    useEffect(() => {
        const mobileViewport = window.matchMedia('(max-width: 920px)');
        const handleViewportChange = (event: MediaQueryListEvent) => {
            if (!event.matches) {
                setMenuOpen(false);
            }
        };

        mobileViewport.addEventListener('change', handleViewportChange);
        return () => mobileViewport.removeEventListener('change', handleViewportChange);
    }, []);

    /* Close menu on route change */
    useEffect(() => {
        setMenuOpen(false);
    }, [pathname]);

    function isActive(href: string): boolean {
        if (href === '/') return pathname === '/';

        if (href === '/buy/properties/') {
            return pathname.startsWith('/buy/') || pathname.startsWith('/properties/');
        }

        return pathname.startsWith(href);
    }

    function isCurrentPage(href: string): boolean {
        const currentPath = pathname.replace(/\/+$/, '') || '/';
        const targetPath = href.replace(/\/+$/, '') || '/';

        if (targetPath === '/buy/properties') {
            return currentPath === targetPath || currentPath === '/properties';
        }

        return currentPath === targetPath;
    }

    return (
        <>
            <span
                aria-hidden="true"
                className={styles.scrollSentinel}
                ref={scrollSentinelRef}
                style={{ top: SCROLL_THRESHOLD_PX }}
            />
            <header
                className={`${styles.header} ${scrolled ? styles.scrolled : ''} ${menuOpen ? styles.headerMenuOpen : ''}`}
                ref={headerRef}
                role="banner"
            >
            <a className={styles.skipLink} href="#main-content">
                Skip to content
            </a>
            <div className={styles.headerInner}>
                <Link
                    className={styles.brand}
                    href="/"
                    aria-label={`${profile.brandName} home`}
                >
                    <span className={styles.brandText}>{profile.brandName}</span>
                </Link>

                <nav
                    className={styles.desktopNav}
                    aria-label="Primary navigation"
                >
                    {navLinks.map((link) => {
                        const active = isActive(link.href);

                        return (
                            <Link
                                aria-current={isCurrentPage(link.href) ? 'page' : undefined}
                                key={link.href}
                                href={link.href}
                                className={active ? styles.navActive : ''}
                            >
                                <span>{link.label}</span>
                            </Link>
                        );
                    })}
                </nav>

                <div className={styles.headerRight}>
                    <div
                        className={styles.headerAffiliation}
                        aria-label={profile.brokerageName}
                    >
                        <span>{profile.brokerageName}</span>
                    </div>

                    <button
                        ref={menuToggleRef}
                        className={`${styles.menuToggle} ${menuOpen ? styles.menuToggleOpen : ''}`}
                        onClick={toggleMenu}
                        aria-expanded={menuOpen}
                        aria-controls="mobile-nav"
                        aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
                        type="button"
                    >
                        <span className={styles.menuBar} />
                        <span className={styles.menuBar} />
                        <span className={styles.menuBar} />
                    </button>
                </div>
            </div>

            {/* Mobile drawer */}
            <div
                className={`${styles.mobileOverlay} ${menuOpen ? styles.mobileOverlayOpen : ''}`}
                onClick={closeMenu}
                aria-hidden="true"
            />
            <nav
                ref={mobileNavRef}
                id="mobile-nav"
                className={`${styles.mobileNav} ${menuOpen ? styles.mobileNavOpen : ''}`}
                aria-label="Mobile navigation"
                aria-hidden={menuOpen ? undefined : true}
                inert={menuOpen ? undefined : true}
            >
                {navLinks.map((link) => {
                    const active = isActive(link.href);

                    return (
                        <Link
                            aria-current={isCurrentPage(link.href) ? 'page' : undefined}
                            key={link.href}
                            href={link.href}
                            className={`${styles.mobileLink} ${active ? styles.mobileLinkActive : ''}`}
                            onClick={closeMenu}
                        >
                            {link.label}
                        </Link>
                    );
                })}
                {profile.contact.phone ? (
                    <a
                        href={profile.contact.phoneHref}
                        className={styles.mobileLink}
                        onClick={closeMenu}
                    >
                        {profile.contact.phone}
                    </a>
                ) : null}
                <a
                    href={`mailto:${profile.contact.email}?subject=${encodeURIComponent('Move With Musto conversation')}`}
                    className={styles.mobileCta}
                    onClick={closeMenu}
                >
                    Send an email
                </a>
            </nav>
            </header>
        </>
    );
}
