const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function encodeBase64(bytes: Uint8Array): string {
    let result = '';
    for (let i = 0; i < bytes.length; i += 3) {
        const b0 = bytes[i];
        const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
        const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
        result += BASE64_CHARS[b0 >> 2];
        result += BASE64_CHARS[((b0 & 0x03) << 4) | (b1 >> 4)];
        result += i + 1 < bytes.length ? BASE64_CHARS[((b1 & 0x0f) << 2) | (b2 >> 6)] : '=';
        result += i + 2 < bytes.length ? BASE64_CHARS[b2 & 0x3f] : '=';
    }
    return result;
}

export function basicAuthHeader(username: string, token: string): string {
    const bytes = new TextEncoder().encode(`${username}:${token}`);
    return `Basic ${encodeBase64(bytes)}`;
}
