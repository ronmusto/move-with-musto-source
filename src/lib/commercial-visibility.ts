/**
 * Commercial stays private until its listing experience is ready to launch.
 * The strict equality is intentional: missing or malformed build settings fail closed.
 */
export function isCommercialPublic(): boolean {
    return process.env.NEXT_PUBLIC_COMMERCIAL_PUBLIC === 'true';
}
