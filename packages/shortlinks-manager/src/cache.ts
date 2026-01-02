export interface ICache {
    init?: () => unknown | Promise<unknown>;
    /**
     * Get the target URL using the provided shortId
     * @param shortId
     * @returns string if a target URL is found, null otherwise
     */
    get: (shortId: string) => string | null | Promise<string | null>;
    /**
     * Cache the target URL
     * @param shortId
     * @param targetUrl
     */
    set: (shortId: string, targetUrl: string) => void | Promise<void>;
}
