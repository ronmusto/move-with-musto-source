import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import './globals.css';
import {
    buildRealEstateMetadata,
    resolveRealEstateProfile,
} from '@/lib/real-estate-profile';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';

const inter = localFont({
    src: './fonts/Inter-Variable.ttf',
    weight: '100 900',
    style: 'normal',
    variable: '--font-inter',
    display: 'swap',
});

const playfair = localFont({
    src: './fonts/PlayfairDisplay-Variable.ttf',
    weight: '400 900',
    style: 'normal',
    variable: '--font-playfair',
    display: 'swap',
});

const profile = resolveRealEstateProfile();

export const viewport: Viewport = {
    width: 'device-width',
    initialScale: 1,
    viewportFit: 'cover',
};

export const metadata: Metadata = buildRealEstateMetadata(profile);

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en" className={`${inter.variable} ${playfair.variable}`}>
            <body>
                <SiteHeader profile={profile} />
                <div id="main-content" tabIndex={-1}>
                    {children}
                </div>
                <SiteFooter profile={profile} />
            </body>
        </html>
    );
}
