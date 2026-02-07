import type { IShortLinksManagerBackend } from "./backend";
import { createBaseUrlManager, type IBaseUrlManager } from "./baseUrl";
import type { ICache } from "./cache";
import { generateUniqueShortIds } from "./utils";

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
     * A special function to queue the promise.
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
     * Base URL manager for managing base URLs
     */
    baseUrl: IBaseUrlManager;

    /**
      * Generate a short ID linking to the target URL
      * @param {string} targetUrl targetUrl
      * @param {number | null} baseUrlId optional base URL ID
      * @returns {Promise<string>} short ID
      * @throws Error if failed
      */
    createShortLink(targetUrl: string, baseUrlId: number | null): Promise<string>;

    /**
      * Get a target URL from the given short ID
      * @param shortId
      * @param baseUrlId optional base URL ID to filter by
      * @returns {Promise<IShortLinkInfo | null>} the target URL info or null if not found
      * @throws Error if backend failed
      */
    getTargetUrl(shortId: string, baseUrlId: number | null): Promise<string | null>;

    /**
      * Update last accessed time to avoid link being cleaned
      * @param shortId
      * @param baseUrlId optional base URL ID to filter by
      * @param time last accessed time. Defaults to current time
      * @throws Error if backend failed
      */
    updateShortLinkLastAccessTime(shortId: string, baseUrlId: number | null, time?: number | Date): Promise<void>;

    /**
      * Clean up unused links that are older than the given maxAge
      * @param maxAge number of days the record should be kept
      * @throws Error if backend failed
      */
    cleanUnusedLinks(maxAge: number): Promise<void>;

    /**
      * Remove a short link by its ID
      * @param shortId the short ID to remove
      * @param baseUrlId optional base URL ID to filter by
      * @throws Error if backend failed
      */
    removeShortLink(shortId: string, baseUrlId: number | null): Promise<void>;
}

export function normalizeCacheKey(baseUrlId: number | null, shortId: string): string {
    const normalizedBase = baseUrlId ?? "any";
    return `${normalizedBase}__${shortId}`;
};

export async function createManager({ backend, caches = [], shortIdLength, onShortIdLengthUpdated, waitUntil, options }: IManagerProps): Promise<IShortLinksManager> {
    await backend.init?.();

    return {
        baseUrl: createBaseUrlManager(backend),

        async createShortLink(targetUrl, baseUrlId) {
            let shortId = "";

            for (let i = 0; i < 3; i++) {
                // Generate multiple IDs to check if any of them are not already taken
                // Then use the first one that is not
                const listToTest = generateUniqueShortIds(50, shortIdLength);
                const existed = await backend.checkShortIdsExist(listToTest, baseUrlId);
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

            await backend.createShortLink(shortId, targetUrl, baseUrlId);

            if (caches.length > 0) {
                const cacheKey = normalizeCacheKey(baseUrlId, shortId);
                const cachePromise = (async () => {
                    for (let i = 0; i < caches.length; i++) {
                        if (!caches[i].initialised) {
                            await caches[i].init?.();
                            caches[i].initialised = true;
                        }
                        await caches[i].set(cacheKey, targetUrl);
                    }
                })();

                if (waitUntil) {
                    waitUntil(cachePromise);
                }
                else {
                    await cachePromise;
                }
            }

            return shortId;
        },

        async getTargetUrl(shortId, baseUrlId) {
            let targetUrl: string | null = null;
            let cacheHitIndex = -1;
            const cacheKey = normalizeCacheKey(baseUrlId, shortId);

            for (let i = 0; i < caches.length; i++) {
                if (!caches[i].initialised) {
                    await caches[i].init?.();
                    caches[i].initialised = true;
                }

                targetUrl = await caches[i].get(cacheKey);
                if (targetUrl) {
                    cacheHitIndex = i;
                    break;
                }
            }

            if (!targetUrl) {
                targetUrl = await backend.getTargetUrl(shortId, baseUrlId);
            }

            if (targetUrl) {
                if (options?.shouldUpdateLastAccessOnGet ?? true) {
                    const updateRes = backend.updateShortLinkLastAccessTime(shortId, baseUrlId);
                    if (waitUntil && updateRes instanceof Promise) {
                        waitUntil(updateRes);
                    }
                    else {
                        await updateRes;
                    }
                }

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
                        await caches[i].set(cacheKey, targetUrl);
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

        async updateShortLinkLastAccessTime(shortId, baseUrlId, time) {
            return await backend.updateShortLinkLastAccessTime(shortId, baseUrlId, time);
        },

        async cleanUnusedLinks(maxAge) {
            const cleanedLinks = await backend.cleanUnusedLinks(maxAge);

            for (const cache of caches) {
                if (!cache.initialised) {
                    await cache.init?.();
                    cache.initialised = true;
                }

                for (const { shortId, baseUrlId } of cleanedLinks) {
                    const cacheKey = normalizeCacheKey(baseUrlId, shortId);
                    await cache.delete(cacheKey);
                }
            }
        },

        async removeShortLink(shortId, baseUrlId) {
            await backend.removeShortLink(shortId, baseUrlId);

            for (const cache of caches) {
                if (!cache.initialised) {
                    await cache.init?.();
                    cache.initialised = true;
                }
                const cacheKey = normalizeCacheKey(baseUrlId, shortId);
                await cache.delete(cacheKey);
            }
        },
    };
}
