'use client';

import { useMemo, useState } from 'react';
import styles from './MortgageCalculator.module.css';

const PRICE_RANGE = { min: 100_000, max: 100_000_000 } as const;
const DOWN_PAYMENT_RANGE = { min: 0, max: 80 } as const;
const RATE_RANGE = { min: 0, max: 15 } as const;

function clampFinite(value: number, min: number, max: number, fallback: number): number {
    if (!Number.isFinite(value)) {
        return fallback;
    }

    return Math.min(Math.max(value, min), max);
}

function calculatePayment(price: number, downPaymentPercent: number, rate: number, years: number): number {
    const safePrice = clampFinite(price, PRICE_RANGE.min, PRICE_RANGE.max, PRICE_RANGE.min);
    const safeDownPayment = clampFinite(
        downPaymentPercent,
        DOWN_PAYMENT_RANGE.min,
        DOWN_PAYMENT_RANGE.max,
        20,
    );
    const safeRate = clampFinite(rate, RATE_RANGE.min, RATE_RANGE.max, 0);
    const safeYears = [15, 20, 30].includes(years) ? years : 30;
    const downPayment = safePrice * (safeDownPayment / 100);
    const principal = Math.max(safePrice - downPayment, 0);
    const monthlyRate = safeRate / 100 / 12;
    const numberOfPayments = safeYears * 12;

    if (monthlyRate === 0) {
        return principal / numberOfPayments;
    }

    return (
        (principal * monthlyRate * (1 + monthlyRate) ** numberOfPayments) /
        ((1 + monthlyRate) ** numberOfPayments - 1)
    );
}

export function MortgageCalculator() {
    const [priceInput, setPriceInput] = useState('850000');
    const [downPaymentInput, setDownPaymentInput] = useState('20');
    const [rateInput, setRateInput] = useState('6.75');
    const [years, setYears] = useState(30);

    const price = clampFinite(Number(priceInput), PRICE_RANGE.min, PRICE_RANGE.max, PRICE_RANGE.min);
    const downPaymentPercent = clampFinite(
        Number(downPaymentInput),
        DOWN_PAYMENT_RANGE.min,
        DOWN_PAYMENT_RANGE.max,
        DOWN_PAYMENT_RANGE.min,
    );
    const rate = clampFinite(Number(rateInput), RATE_RANGE.min, RATE_RANGE.max, RATE_RANGE.min);

    const monthlyPayment = useMemo(
        () => calculatePayment(price, downPaymentPercent, rate, years),
        [downPaymentPercent, price, rate, years],
    );

    return (
        <section className={styles.calculator} aria-labelledby="mortgage-calculator-title">
            <div>
                <p className={styles.eyebrow}>Planning tool</p>
                <h2 id="mortgage-calculator-title">Estimate a monthly principal and interest payment.</h2>
            </div>
            <div className={styles.controls}>
                <label>
                    <span>Purchase price</span>
                    <input
                        min={100000}
                        max={PRICE_RANGE.max}
                        step={10000}
                        type="number"
                        value={priceInput}
                        onBlur={() => setPriceInput(String(price))}
                        onChange={(event) => setPriceInput(event.currentTarget.value)}
                    />
                </label>
                <label>
                    <span>Down payment %</span>
                    <input
                        max={80}
                        min={0}
                        step={1}
                        type="number"
                        value={downPaymentInput}
                        onBlur={() => setDownPaymentInput(String(downPaymentPercent))}
                        onChange={(event) => setDownPaymentInput(event.currentTarget.value)}
                    />
                </label>
                <label>
                    <span>Interest rate %</span>
                    <input
                        max={15}
                        min={0}
                        step={0.125}
                        type="number"
                        value={rateInput}
                        onBlur={() => setRateInput(String(rate))}
                        onChange={(event) => setRateInput(event.currentTarget.value)}
                    />
                </label>
                <label>
                    <span>Loan term</span>
                    <select
                        value={years}
                        onChange={(event) => setYears(Number(event.currentTarget.value))}
                    >
                        <option value={15}>15 years</option>
                        <option value={20}>20 years</option>
                        <option value={30}>30 years</option>
                    </select>
                </label>
            </div>
            <output className={styles.output} aria-live="polite">
                <span>Estimated monthly payment</span>
                <strong>
                    {monthlyPayment.toLocaleString('en-US', {
                        style: 'currency',
                        currency: 'USD',
                        maximumFractionDigits: 0,
                    })}
                </strong>
            </output>
            <p className={styles.note}>
                Inputs are limited to a $100,000-$100,000,000 purchase price, 0%-80% down,
                and a 0%-15% rate. Estimate excludes taxes, insurance, HOA fees, mortgage
                insurance, and closing costs.
            </p>
        </section>
    );
}
