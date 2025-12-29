import { generateUniqueShortIds } from "./utils";

export interface IShortLinksManagerBackend {
    init?: () => unknown;
    getTargetUrl: (shortId: string) => string | null | Promise<string | null>;
    createShortLink: (shortId: string, targetUrl: string) => void | Promise<void>;
    checkShortIdsExist: (shortIds: string[]) => string[] | Promise<string[]>;
}

export class ShortLinksManager {
    private backend: IShortLinksManagerBackend;
    private shortIdLength: number;
    private onShortIdLengthUpdated: (newLength: number) => unknown;

    constructor({ backend, shortIdLength, onShortIdLengthUpdated }: ICreateManagerProps) {
        this.backend = backend;
        this.shortIdLength = shortIdLength;
        this.onShortIdLengthUpdated = onShortIdLengthUpdated;
    }

    public async createShortLink(targetUrl: string): Promise<string> {
        let shortId = "";

        for (let i = 0; i < 10; i++) {
            // Generate multiple IDs to check if any of them are not already taken
            // Then use the first one that is not
            const listToTest = generateUniqueShortIds(50, this.shortIdLength);
            const existed = await this.backend.checkShortIdsExist(listToTest);
            const uniqueShortId = listToTest.find(id => !existed.includes(id));

            if (!uniqueShortId) {
                ++this.shortIdLength;
                await this.onShortIdLengthUpdated(this.shortIdLength);
            }
            else {
                shortId = uniqueShortId;
                break;
            }
        }

        await this.backend.createShortLink(shortId, targetUrl);

        return shortId;
    }
}

interface ICreateManagerProps {
    backend: IShortLinksManagerBackend;
    shortIdLength: number;
    onShortIdLengthUpdated: (newLength: number) => unknown;
}

export async function createManager(props: ICreateManagerProps) {
    await props.backend.init?.();
    return new ShortLinksManager(props);
}
