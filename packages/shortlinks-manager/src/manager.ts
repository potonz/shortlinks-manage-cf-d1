import type { ICache } from "./cache";
import { generateUniqueShortIds } from "./utils";

export interface IShortLinksManagerBackend {
    /**
     * Initialise any logic before the manager can do its thing. E.g. setting up tables.
     * Run once when {@link createManager} is called
     */
    init?: () => unknown;
    /**
     * Get target URL for the given short ID
     * @param {string} shortId
     * @returns the short ID or null if not found
     */
    getTargetUrl: (shortId: string) => string | null | Promise<string | null>;
    /**
     * Create a short link map with the given short ID and target URL
     * @param {string} shortId
     * @param {string} targetUrl
     */
    createShortLink: (shortId: string, targetUrl: string) => void | Promise<void>;
    /**
     * Check the provided list of short IDs and return the ones that already exist.
     * @param {string[]} shortIds
     */
    checkShortIdsExist: (shortIds: string[]) => string[] | Promise<string[]>;
    /**
     * Update last accessed time to current timestamp
     * @param shortId
     */
    updateShortLinkLastAccessTime(shortId: string): void | Promise<void>;
    /**
     * Remove unused links that are older than the given maxAge
     * @param maxAge number of days the record should be kept
     */
    cleanUnusedLinks(maxAge: number): void | Promise<void>;
}

interface IManagerProps {
    backend: IShortLinksManagerBackend;
    /**
     * A list of cache to use before invoking the backend.
     * If multiple cache are provided, the manager will try from first to last.
     * Default to no cache
     */
    caches?: ICache[];
    shortIdLength: number;
    onShortIdLengthUpdated: (newLength: number) => unknown;
    /**
     * A special function to queue the {@link promise}.
     *
     * Useful when running in Cloudflare Worker to
     * run the promise after the responding to the client.
     *
     * This function is used where, for example, updating all caches
     * if a target URL is found in the backend. We want to return
     * the URL right away but queue writing to cache after responding to the client.
     * @param promise
     */
    waitUntil?: (promise: Promise<unknown>) => void;
    options?: {
        /**
         * Whether to update the backend with last access time
         * on {@link IShortLinksManager#getTargetUrl()} call.
         * Set to `false` if you want to manually manage this.
         * Defaults to `true`
         */
        shouldUpdateLastAccessOnGet?: boolean;
    };
}

export interface IShortLinksManager {
    /**
     * Generate a short ID linking to the target URL
     * @param {string} targetUrl targetUrl
     * @returns {Promise<string>} short ID
     * @throws Error if failed
     */
    createShortLink(targetUrl: string): Promise<string>;

    /**
     * Get a target URL from the given short ID
     * @param shortId
     * @returns the target URL as string or null if not found
     * @throws Error if backend failed
     */
    getTargetUrl(shortId: string): Promise<string | null>;

    /**
     * Update last accessed time to avoid link being cleaned
     * @param shortId
     * @param time last accessed time. Defaults to current time
     * @throws Error if backend failed
     */
    updateShortLinkLastAccessTime(shortId: string, time: Date): Promise<void>;

    /**
     * Clean up unused links that are older than the given maxAge
     * @param maxAge number of days the record should be kept
     * @throws Error if backend failed
     */
    cleanUnusedLinks(maxAge: number): Promise<void>;
}

export async function createManager({ backend, caches = [], shortIdLength, onShortIdLengthUpdated, waitUntil, options }: IManagerProps): Promise<IShortLinksManager> {
    await backend.init?.();

    return {
        async createShortLink(targetUrl: string): Promise<string> {
            let shortId = "";

            for (let i = 0; i < 3; i++) {
                // Generate multiple IDs to check if any of them are not already taken
                // Then use the first one that is not
                const listToTest = generateUniqueShortIds(50, shortIdLength);
                const existed = await backend.checkShortIdsExist(listToTest);
                const uniqueShortId = listToTest.find(id => !existed.includes(id));

                if (!uniqueShortId) {
                    ++shortIdLength;

                    const updateRes = onShortIdLengthUpdated(shortIdLength);
                    if (waitUntil && updateRes instanceof Promise) {
                        waitUntil(updateRes);
                    }
                    else {
                        await updateRes;
                    }
                }
                else {
                    shortId = uniqueShortId;
                    break;
                }
            }

            if (!shortId) {
                throw new Error("Unable to create a shortlink, potentially ran out");
            }

            await backend.createShortLink(shortId, targetUrl);

            return shortId;
        },

        async getTargetUrl(shortId) {
            let targetUrl: string | null = null;
            let cacheHitIndex = -1;

            for (let i = 0; i < caches.length; i++) {
                if (!caches[i].initialised) {
                    await caches[i].init?.();
                    caches[i].initialised = true;
                }

                targetUrl = await caches[i].get(shortId);
                if (targetUrl) {
                    cacheHitIndex = i;
                    break;
                }
            }

            if (!targetUrl) {
                targetUrl = await backend.getTargetUrl(shortId);
            }

            if (targetUrl) {
                if (options?.shouldUpdateLastAccessOnGet ?? true) {
                    const updateRes = backend.updateShortLinkLastAccessTime(shortId);
                    if (waitUntil && updateRes instanceof Promise) {
                        waitUntil(updateRes);
                    }
                    else {
                        await updateRes;
                    }
                }

                // Only update caches that were miss
                // Avoid rewriting to a hit cache
                let cacheToUpdateCount = caches.length;
                if (cacheHitIndex >= 0) {
                    cacheToUpdateCount = cacheHitIndex;
                }

                for (let i = 0; i < cacheToUpdateCount; i++) {
                    const updateRes = (async function () {
                        if (!caches[i].initialised) {
                            await caches[i].init?.();
                            caches[i].initialised = true;
                        }
                        await caches[i].set(shortId, targetUrl);
                    })();

                    if (waitUntil) {
                        waitUntil(updateRes);
                    }
                    else {
                        await updateRes;
                    }
                }
            }

            return targetUrl;
        },

        async updateShortLinkLastAccessTime(shortId) {
            return await backend.updateShortLinkLastAccessTime(shortId);
        },

        async cleanUnusedLinks(maxAge: number) {
            await backend.cleanUnusedLinks(maxAge);
        },
    };
}
