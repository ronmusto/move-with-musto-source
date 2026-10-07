'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { LocalResponsiveImage } from '@/components/LocalResponsiveImage';
import styles from './SellerScrollyProcess.module.css';

type SellerProcessVisual =
    | {
        type: 'photo-checklist';
        label: string;
        image: string;
        alt: string;
        checks: string[];
    }
    | {
        type: 'market-lenses';
        label: string;
        lenses: ReadonlyArray<{
            label: string;
            note: string;
        }>;
    }
    | {
        type: 'timeline';
        label: string;
        stages: ReadonlyArray<{
            label: string;
            note: string;
        }>;
    }
    | {
        type: 'offer-matrix';
        label: string;
        offers: ReadonlyArray<{
            label: string;
            price: string;
            certainty: string;
            timing: string;
        }>;
    };

export type SellerProcessStep = {
    title: string;
    summary: string;
    detail: string;
    signal: string;
    outcome: string;
    visual: SellerProcessVisual;
};

type SellerScrollyProcessProps = {
    steps: ReadonlyArray<SellerProcessStep>;
};

function formatStepNumber(index: number): string {
    return String(index + 1).padStart(2, '0');
}

function getProgrammaticScrollBehavior(): ScrollBehavior {
    if (typeof window.matchMedia !== 'function') {
        return 'smooth';
    }

    return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
}

function StepVisual({ visual }: Readonly<{ visual: SellerProcessVisual }>) {
    if (visual.type === 'photo-checklist') {
        return (
            <figure className={`${styles.stepVisual} ${styles.photoVisual}`} aria-label={visual.label}>
                <div className={styles.photoFrame}>
                    <LocalResponsiveImage
                        alt={visual.alt}
                        fill
                        sizes="(max-width: 980px) 100vw, 28vw"
                        src={visual.image}
                    />
                </div>
                <figcaption>
                    <span>{visual.label}</span>
                    <ul>
                        {visual.checks.map((check) => (
                            <li key={check}>{check}</li>
                        ))}
                    </ul>
                </figcaption>
            </figure>
        );
    }

    if (visual.type === 'market-lenses') {
        return (
            <figure className={`${styles.stepVisual} ${styles.marketVisual}`} aria-label={visual.label}>
                <figcaption>{visual.label}</figcaption>
                <div className={styles.marketLensGrid}>
                    {visual.lenses.map((lens, index) => (
                        <div className={styles.marketLensCard} key={lens.label}>
                            <span>{formatStepNumber(index)}</span>
                            <div>
                                <strong>{lens.label}</strong>
                                <p>{lens.note}</p>
                            </div>
                        </div>
                    ))}
                </div>
            </figure>
        );
    }

    if (visual.type === 'timeline') {
        return (
            <figure className={`${styles.stepVisual} ${styles.timelineVisual}`} aria-label={visual.label}>
                <figcaption>{visual.label}</figcaption>
                <ol>
                    {visual.stages.map((stage) => (
                        <li key={stage.label}>
                            <span>{stage.label}</span>
                            <p>{stage.note}</p>
                        </li>
                    ))}
                </ol>
            </figure>
        );
    }

    return (
        <figure className={`${styles.stepVisual} ${styles.matrixVisual}`} aria-label={visual.label}>
            <figcaption>{visual.label}</figcaption>
            <div className={styles.offerMatrix}>
                {visual.offers.map((offer) => (
                    <div className={styles.offerColumn} key={offer.label}>
                        <span>{offer.label}</span>
                        <dl>
                            <div><dt>Price</dt><dd>{offer.price}</dd></div>
                            <div><dt>Certainty</dt><dd>{offer.certainty}</dd></div>
                            <div><dt>Timing</dt><dd>{offer.timing}</dd></div>
                        </dl>
                    </div>
                ))}
            </div>
        </figure>
    );
}

export function SellerScrollyProcess({ steps }: SellerScrollyProcessProps) {
    const [activeIndex, setActiveIndex] = useState(0);
    const stepRefs = useRef<Array<HTMLElement | null>>([]);

    useEffect(() => {
        const observedSteps = stepRefs.current.filter((step): step is HTMLElement => Boolean(step));

        if (!observedSteps.length || !('IntersectionObserver' in window)) {
            return;
        }

        const observer = new IntersectionObserver(
            (entries) => {
                const visibleEntry = entries
                    .filter((entry) => entry.isIntersecting)
                    .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

                if (visibleEntry) {
                    setActiveIndex(Number(visibleEntry.target.getAttribute('data-step-index') ?? 0));
                }
            },
            {
                rootMargin: '-34% 0px -34% 0px',
                threshold: [0.25, 0.45, 0.65],
            },
        );

        observedSteps.forEach((step) => observer.observe(step));
        return () => observer.disconnect();
    }, [steps]);

    const activeStep = steps[activeIndex] ?? steps[0];
    const progressStyle = useMemo(
        () =>
            ({
                '--progress': `${steps.length > 1 ? (activeIndex / (steps.length - 1)) * 100 : 100}%`,
            }) as CSSProperties,
        [activeIndex, steps.length],
    );

    if (!activeStep) {
        return null;
    }

    return (
        <section className={styles.scrollySection} aria-labelledby="seller-process-title">
            <div className={styles.shell}>
                <aside className={styles.stickyPanel}>
                    <div>
                        <p className={styles.eyebrow}>Listing sequence</p>
                        <h2 id="seller-process-title">A composed sale, step by step.</h2>
                        <p className={styles.panelCopy}>
                            Follow the work that happens before, during, and after a listing launch.
                        </p>
                    </div>

                    <div className={styles.activeCard}>
                        <span className={styles.activeNumber}>Step {formatStepNumber(activeIndex)}</span>
                        <h3>{activeStep.title}</h3>
                        <p>{activeStep.summary}</p>
                    </div>

                    <div className={styles.progressWrap} style={progressStyle} aria-hidden="true">
                        <span className={styles.progressFill} />
                    </div>

                    <ol className={styles.stepNav} aria-label="Seller process steps">
                        {steps.map((step, index) => (
                            <li key={step.title}>
                                <button
                                    type="button"
                                    className={index === activeIndex ? styles.navActive : ''}
                                    aria-current={index === activeIndex ? 'step' : undefined}
                                    onClick={() => stepRefs.current[index]?.scrollIntoView({
                                        behavior: getProgrammaticScrollBehavior(),
                                        block: 'center',
                                    })}
                                >
                                    <span>{formatStepNumber(index)}</span>
                                    {step.title}
                                </button>
                            </li>
                        ))}
                    </ol>
                </aside>

                <div className={styles.stepTrack}>
                    {steps.map((step, index) => (
                        <article
                            className={styles.stepScene}
                            data-active={index === activeIndex}
                            data-step-index={index}
                            key={step.title}
                            ref={(node) => {
                                stepRefs.current[index] = node;
                            }}
                        >
                            <div className={styles.stepInner}>
                                <div className={styles.stepHeader}>
                                    <span className={styles.stepLabel}>Step {formatStepNumber(index)}</span>
                                    <h3>{step.title}</h3>
                                    <p className={styles.summary}>{step.summary}</p>
                                </div>

                                <div className={styles.stepContent}>
                                    <StepVisual visual={step.visual} />

                                    <div className={styles.stepCopyStack}>
                                        <div className={styles.detailGrid}>
                                            <div>
                                                <span>What the plan considers</span>
                                                <p>{step.detail}</p>
                                            </div>
                                            <div>
                                                <span>Decision signal</span>
                                                <p>{step.signal}</p>
                                            </div>
                                        </div>
                                        <p className={styles.outcome}>{step.outcome}</p>
                                    </div>
                                </div>
                            </div>
                        </article>
                    ))}
                </div>
            </div>
        </section>
    );
}
