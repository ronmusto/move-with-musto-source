import { isIP } from 'node:net';

function validPort(value) {
    return /^\d{1,5}$/u.test(value) && Number(value) > 0 && Number(value) <= 65_535;
}

// CloudFront supplies an address plus a source port. A low, decimal IPv6
// source port can also look like a hextet, so split it before testing IPv6.
// Only use this with the header from the origin-secret-verified request.
export function cloudFrontViewerIp(rawValue) {
    const value = typeof rawValue === 'string' ? rawValue.trim() : '';
    const bracketed = /^\[([^\]]+)\](?::([^:]+))?$/u.exec(value);
    if (bracketed) {
        return isIP(bracketed[1]) === 6
            && (bracketed[2] === undefined || validPort(bracketed[2]))
            ? bracketed[1] : '';
    }
    if (isIP(value) === 4) return value;

    const separator = value.lastIndexOf(':');
    const port = separator > 0 ? value.slice(separator + 1) : '';
    const address = separator > 0 ? value.slice(0, separator) : '';
    if (validPort(port) && isIP(address)) return address;
    return '';
}
