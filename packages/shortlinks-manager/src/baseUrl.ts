import type { IBaseUrlRecord, IShortLinksManagerBackend } from "./backend";

export interface IBaseUrlManager {
    add(baseUrl: string): Promise<void>;
    remove(baseUrl: number): Promise<void>;
    list(includeInactive?: boolean): Promise<IBaseUrlRecord[]>;
    getBaseUrlId(baseUrl: string): Promise<number>;
    getBaseUrl(id: number): Promise<string>;
}

export function createBaseUrlManager(backend: IShortLinksManagerBackend): IBaseUrlManager {
    return {
        async add(baseUrl: string): Promise<void> {
            return backend.baseUrl.add(baseUrl);
        },
        async remove(id: number): Promise<void> {
            return backend.baseUrl.remove(id);
        },
        async list(includeInactive?: boolean): Promise<IBaseUrlRecord[]> {
            return backend.baseUrl.list(includeInactive);
        },
        async getBaseUrlId(baseUrl: string): Promise<number> {
            return backend.baseUrl.getId(baseUrl);
        },
        async getBaseUrl(id: number): Promise<string> {
            return backend.baseUrl.getById(id);
        },
    };
}
