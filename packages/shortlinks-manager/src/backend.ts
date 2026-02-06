export interface IBaseUrlRecord {
    id: number;
    baseUrl: string;
    isActive?: boolean;
}

export interface IShortLinksManagerBackend {
    /**
     * Initialise any logic before the manager can do its thing. E.g. setting up tables.
     * Run once when {@link createManager} is called
     */
    init?: () => unknown;
    /**
      * Get target URL for the given short ID
      * @param {string} shortId
      * @param {number} baseUrlId optional base URL ID to filter by
      * @returns the target URL or null if not found
      */
    getTargetUrl(shortId: string, baseUrlId: number | null): string | null | Promise<string | null>;
    /**
      * Create a short link map with the given short ID and target URL
      * @param {string} shortId
      * @param {string} targetUrl
      * @param {number} baseUrlId optional base URL ID
      */
    createShortLink(shortId: string, targetUrl: string, baseUrlId: number | null): void | Promise<void>;
    /**
      * Check the provided list of short IDs and return the ones that already exist.
      * @param {string[]} shortIds
      * @param {number} baseUrlId optional base URL ID to check within
      */
    checkShortIdsExist(shortIds: string[], baseUrlId: number | null): string[] | Promise<string[]>;
    /**
      * Update last accessed time to current timestamp
      * @param shortId
      * @param baseUrlId optional base URL ID to filter by
      * @param time Unix timestamp or a Date object
      */
    updateShortLinkLastAccessTime(shortId: string, baseUrlId: number | null, time?: number | Date): void | Promise<void>;
    /**
      * Remove unused links that are older than the given maxAge
      * @param maxAge number of days the record should be kept
      * @returns an array of short IDs that have been cleaned
      */
    cleanUnusedLinks(maxAge: number): string[] | Promise<string[]>;
    /**
      * Remove a short link by its ID
      * @param shortId the short ID to remove
      * @param baseUrlId optional base URL ID to filter by
      */
    removeShortLink(shortId: string, baseUrlId: number | null): void | Promise<void>;

    baseUrl: {
        /**
         * Add a new base URL
         * @param baseUrl the base URL to add
         */
        add(baseUrl: string): void | Promise<void>;
        /**
         * Remove a base URL by its ID
         * @param id the ID of the base URL to remove
         */
        remove(id: number): void | Promise<void>;
        /**
         * List all base URLs
         * @param includeInactive whether to include inactive base URLs (default: false)
         * @returns array of base URL records
         */
        list(includeInactive?: boolean): IBaseUrlRecord[] | Promise<IBaseUrlRecord[]>;
        /**
         * Get the ID for a base URL
         * @param baseUrl the base URL to get the ID for
         * @returns the base URL ID or null if not found
         */
        getId(baseUrl: string): number | Promise<number>;
    };
}
