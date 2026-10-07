import type { Metadata } from 'next';
import { LegacyPropertySearchRedirect } from '../LegacyPropertySearchRedirect';

export const metadata: Metadata = {
    title: 'Property Search | Move With Musto',
    alternates: { canonical: '/buy/properties/' },
    robots: { index: false, follow: true },
};

export default function BuyPage() {
    return <LegacyPropertySearchRedirect />;
}
