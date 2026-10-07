import type { CSSProperties, ComponentPropsWithoutRef } from 'react';
import responsiveImageAssets from '@/lib/responsive-image-assets.json';

type NativeImageProps = Omit<
    ComponentPropsWithoutRef<'img'>,
    'alt' | 'height' | 'loading' | 'src' | 'srcSet' | 'width'
>;

type LocalResponsiveImageProps = NativeImageProps & {
    alt: string;
    fill?: boolean;
    height?: number;
    loading?: 'eager' | 'lazy';
    priority?: boolean;
    src: string;
    width?: number;
};

const fillStyle: CSSProperties = {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    color: 'transparent',
};

function variantPath(src: string, width: number): string {
    return src.replace(/(\.[a-z0-9]+)$/i, `-${width}w$1`);
}

export function getLocalImageSrcSet(src: string, intrinsicWidth?: number): string | undefined {
    const imageConfig = responsiveImageAssets[src as keyof typeof responsiveImageAssets];

    if (!imageConfig) {
        return undefined;
    }

    const { widths } = imageConfig;
    const candidates = widths.map((width) => `${variantPath(src, width)} ${width}w`);
    const originalWidth = intrinsicWidth ?? imageConfig.intrinsicWidth;

    if (originalWidth > widths.at(-1)!) {
        candidates.push(`${src} ${originalWidth}w`);
    }

    return candidates.join(', ');
}

export function LocalResponsiveImage({
    alt,
    fill = false,
    height,
    loading,
    priority = false,
    src,
    style,
    width,
    ...props
}: Readonly<LocalResponsiveImageProps>) {
    return (
        <img
            {...props}
            alt={alt}
            decoding="async"
            fetchPriority={priority ? 'high' : props.fetchPriority}
            height={fill ? undefined : height}
            loading={priority ? 'eager' : (loading ?? 'lazy')}
            src={src}
            srcSet={getLocalImageSrcSet(src, width)}
            style={fill ? { ...fillStyle, ...style } : style}
            width={fill ? undefined : width}
        />
    );
}
