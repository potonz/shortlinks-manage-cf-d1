export const ALLOWED_CHARS = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const CHAR2INDEX_MAP: Record<string, number> = {};
for (let i = 0; i < ALLOWED_CHARS.length; i++) {
    CHAR2INDEX_MAP[ALLOWED_CHARS[i]!] = i;
}

export function generateRandomShortId(length = 4) {
    let result = "";
    for (let i = 0; i < length; i++) {
        result += ALLOWED_CHARS.charAt(Math.floor(Math.random() * ALLOWED_CHARS.length));
    }
    return result;
}

export function generateUniqueShortIds(count: number, length: number): string[] {
    const ids = new Set<string>();
    let loop = 0;
    while (ids.size < count && loop < count * 100) {
        ids.add(generateRandomShortId(length));
        loop++;
    }
    return Array.from(ids);
}
