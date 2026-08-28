import { IHttp, ILogger } from '@rocket.chat/apps-engine/definition/accessors';

const CACHE_TTL_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10000;

interface CachedSummary {
    summary: string | null;
    expiresAt: number;
}

export class JiraClient {
    private cache: Map<string, CachedSummary> = new Map();

    constructor(
        private readonly http: IHttp,
        private readonly logger: ILogger,
        private readonly baseUrl: string,
        private readonly authHeaders: Record<string, string>,
    ) {}

    public async getSummary(key: string): Promise<string | null> {
        const now = Date.now();
        const cached = this.cache.get(key);
        if (cached && cached.expiresAt > now) {
            return cached.summary;
        }
        if (cached) {
            this.cache.delete(key);
        }

        let summary: string | null = null;
        try {
            const response = await this.http.get(
                `${this.baseUrl}/rest/api/2/issue/${encodeURIComponent(key)}?fields=summary`,
                {
                    headers: { Accept: 'application/json', ...this.authHeaders },
                    timeout: REQUEST_TIMEOUT_MS,
                },
            );

            if (response.statusCode === 200) {
                const body = this.parseBody(response.content || '');
                summary = body && typeof body.fields.summary === 'string' ? body.fields.summary : '';
                this.logger.log(`[rocket-jira] ${key}: "${summary}"`);
            } else if (response.statusCode === 404) {
                this.logger.log(`[rocket-jira] ${key}: not found, leaving text untouched`);
            } else if (response.statusCode === 401 || response.statusCode === 403) {
                this.logger.error(
                    `[rocket-jira] ${key}: HTTP ${response.statusCode} - check the Jira URL/credentials and that the user has "Browse Projects" permission`,
                );
            } else {
                this.logger.error(`[rocket-jira] ${key}: unexpected status ${response.statusCode}, leaving text untouched`);
            }
        } catch (err) {
            const message = err && err.message ? err.message : String(err);
            this.logger.error(`[rocket-jira] ${key}: request failed (${message}), leaving text untouched`);
        }

        this.cache.set(key, { summary, expiresAt: now + CACHE_TTL_MS });
        return summary;
    }

    private parseBody(content: string): any {
        try {
            return JSON.parse(content);
        } catch (err) {
            return null;
        }
    }
}
