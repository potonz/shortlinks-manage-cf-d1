export interface ICache {
    initialised?: boolean;
    init?: () => (unknown | Promise<unknown>);
    /**
     * Get the target URL using the provided shortId
     * @param key
     * @returns string if a target URL is found, null otherwise
     */
    get: (key: string) => (string | null | Promise<string | null>);
    /**
     * Cache the target URL
     * @param key
     * @param targetUrl
     */
    set: (key: string, targetUrl: string) => (void | Promise<void>);
    /**
     * Delete the short ID in the cache
     * @param key
     */
    delete: (key: string) => (void | Promise<void>);
}
