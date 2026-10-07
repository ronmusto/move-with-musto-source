function isPrivateOrLocalHostname(hostname: string) {
    const normalized = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
    if (!normalized || normalized === 'localhost' || normalized.endsWith('.localhost')) {
        return true;
    }

    if (normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:')) {
        return true;
    }

    const octets = normalized.split('.').map(Number);
    if (octets.length !== 4 || !octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)) {
        return false;
    }

    return octets[0] === 0 ||
        octets[0] === 10 ||
        octets[0] === 127 ||
        (octets[0] === 169 && octets[1] === 254) ||
        (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
        (octets[0] === 192 && octets[1] === 168) ||
        (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) ||
        octets[0] >= 224;
}

export function sanitizePublicHttpsUrl(value: unknown) {
    const candidate = String(value ?? '').trim();
    if (!candidate || /^(?:null|none|n\/a|na|-)$/i.test(candidate)) {
        return '';
    }

    try {
        const parsed = new URL(candidate);
        if (
            parsed.protocol !== 'https:' ||
            !parsed.hostname ||
            parsed.username ||
            parsed.password ||
            isPrivateOrLocalHostname(parsed.hostname)
        ) {
            return '';
        }
        return parsed.toString();
    } catch {
        return '';
    }
}
