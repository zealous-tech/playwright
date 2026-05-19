import { z } from 'playwright-core/lib/mcpBundle';
import { defineTabTool } from '../../tool';
import type * as playwright from 'playwright-core';


class RequestsNotFound extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'RequestsNotFound';
    }
}

interface LogType {
    request: {
        headers: boolean;
        body: boolean;
    };
    response: {
        headers: boolean;
        body: boolean;
    };
}

interface FieldFilter {
    name: string;
    value?: string;
    matchType: 'is_equal' | 'contains' | 'exists';
}

interface BodyFieldFilter {
    fieldPath: string;
    value?: string;
    matchType: 'is_equal' | 'contains' | 'exists';
}

type Input = {
    method?: string;
    url?: string;
    endpoint?: string;
    keywords?: string[];
    logType?: LogType;
    index?: 'first' | 'last' | number;
    queryParams?: FieldFilter[];
    requestHeaders?: FieldFilter[];
    responseHeaders?: FieldFilter[];
    requestBodyFields?: BodyFieldFilter[];
    responseBodyFields?: BodyFieldFilter[];
};


const fieldFilterSchema = z.object({
    name: z.string().describe('Name of the field (header name or query parameter name)'),
    value: z.string().optional().describe('Value to match against (not required for "exists" matchType)'),
    matchType: z.enum(['is_equal', 'contains', 'exists']).describe('"is_equal" for exact match, "contains" for substring match, "exists" to check if the header/param is present'),
});

const bodyFieldFilterSchema = z.object({
    fieldPath: z.string().describe('Dot-notation path to the field in JSON body (e.g., "data.userId", "items[0].name")'),
    value: z.string().optional().describe('Value to match against (not required for "exists" matchType)'),
    matchType: z.enum(['is_equal', 'contains', 'exists']).describe('"is_equal" for exact match, "contains" for substring match, "exists" to check field presence'),
});

export const otto_requests = defineTabTool({
    capability: 'core',

    schema: {
        name: 'otto_browser_network_requests',
        title: 'Find specific network request',
        description:
            'Search network request logs and return a matching entry that satisfies structured filters (method/url/endpoint/queryParams/headers/bodyFields) AND contains ALL specified keywords. URL and endpoint filters support RegExp when wrapped in /pattern/flags (e.g. "/\\/v1\\/resources$/"). Keywords are searched across method, URL, headers, and bodies (case-sensitive). Use logType to control which fields are included in the output. Use index to select which match to return (default: last/newest).',
        inputSchema: z.object({
            method: z
                .string()
                .optional()
                .describe('HTTP method to match (e.g., "GET"). Case-sensitive exact token match.'),
            url: z
                .string()
                .optional()
                .describe('Full or partial URL to match. Plain string = substring match (case-sensitive). Wrap in /…/ for RegExp (e.g. "/\\/v1\\/resources$/").'),
            endpoint: z
                .string()
                .optional()
                .describe('Pathname to match (against pathname+search). Plain string = substring match (case-sensitive). Wrap in /…/ for RegExp (e.g. "/\\/api\\/users$/").'),
            keywords: z
                .array(z.string())
                .default([])
                .describe('Array of keywords that must ALL be present somewhere in the request/response data (case-sensitive).'),
            logType: z
                .object({
                    request: z
                        .object({
                            headers: z.boolean().default(true).describe('Include request headers in output'),
                            body: z.boolean().default(true).describe('Include request body in output'),
                        })
                        .default({ headers: false, body: false }),
                    response: z
                        .object({
                            headers: z.boolean().default(true).describe('Include response headers in output'),
                            body: z.boolean().default(true).describe('Include response body in output'),
                        })
                        .default({ headers: false, body: false }),
                })
                .optional()
                .describe('Controls what information to include in the output. If not provided, includes nothing.'),
            index: z
                .union([z.enum(['first', 'last']), z.number().int().min(0)])
                .optional()
                .describe('Select which matching request to return. "first" = oldest match, "last" = newest match (default behavior when omitted), or a 0-based index into the list of matched results sorted oldest-to-newest.'),
            queryParams: z
                .array(fieldFilterSchema)
                .optional()
                .describe('Filter by URL query parameters. ALL conditions must match. Supports "is_equal", "contains", and "exists" match types. Use "exists" to check param presence without matching a value.'),
            requestHeaders: z
                .array(fieldFilterSchema)
                .optional()
                .describe('Filter by request headers. ALL conditions must match. Header name matching is case-insensitive. Supports "is_equal", "contains", and "exists" match types. Use "exists" to check header presence without matching a value.'),
            responseHeaders: z
                .array(fieldFilterSchema)
                .optional()
                .describe('Filter by response headers. ALL conditions must match. Header name matching is case-insensitive. Supports "is_equal", "contains", and "exists" match types. Use "exists" to check header presence without matching a value.'),
            requestBodyFields: z
                .array(bodyFieldFilterSchema)
                .optional()
                .describe('Filter by fields in the request JSON body. ALL conditions must match. Use dot-notation for nested paths (e.g., "data.userId"). Supports "is_equal", "contains", and "exists" match types.'),
            responseBodyFields: z
                .array(bodyFieldFilterSchema)
                .optional()
                .describe('Filter by fields in the response JSON body. ALL conditions must match. Use dot-notation for nested paths (e.g., "data.items[0].id"). Supports "is_equal", "contains", and "exists" match types.'),
        }),
        type: 'readOnly',
    },

    handle: async (tab, params: Input, response) => {
        const allRequests = tab.requests();

        const {
            method: methodFilter,
            url: urlFilter,
            endpoint: endpointFilter,
            keywords = [],
            index: indexParam,
            queryParams: queryParamsFilter = [],
            requestHeaders: reqHeadersFilter = [],
            responseHeaders: resHeadersFilter = [],
            requestBodyFields: reqBodyFieldsFilter = [],
            responseBodyFields: resBodyFieldsFilter = [],
        } = params;

        const logType: LogType =
            params.logType || {
                request: { headers: false, body: false },
                response: { headers: false, body: false },
            };

        const methodNorm = methodFilter?.trim();
        const urlNorm = urlFilter?.trim();
        const endpointNorm = endpointFilter?.trim();
        const keywordsNorm = keywords.map((k) => k);

        const hasAdvancedFilters =
            queryParamsFilter.length > 0 ||
            reqHeadersFilter.length > 0 ||
            resHeadersFilter.length > 0 ||
            reqBodyFieldsFilter.length > 0 ||
            resBodyFieldsFilter.length > 0;

        const needsCollectAll = indexParam !== undefined || hasAdvancedFilters;

        const resolvedRequests = [...await allRequests];

        if (!needsCollectAll) {
            // Fast path: original behavior — iterate backwards, return first (latest) match
            for (let i = resolvedRequests.length - 1; i >= 0; i--) {
                const req = resolvedRequests[i];
                if (!matchesStructuredFilters(req, methodNorm, urlNorm, endpointNorm))
                    continue;

                const res = await req.response().catch(() => null);

                if (keywordsNorm.length === 0) {
                    const out = await safeRender(req, res, logType);
                    if (hasBodyError(out))
                        continue;
                    response.addResult({ text: out });
                    return;
                }

                try {
                    const detailed = await renderRequestDetailed(req, res, logType);
                    if (hasBodyError(detailed))
                        continue;
                    if (containsAllKeywords(detailed, keywordsNorm)) {
                        response.addResult({ text: detailed });
                        return;
                    }
                } catch {
                    const basic = renderRequest(req, res);
                    if (containsAllKeywords(basic, keywordsNorm)) {
                        response.addResult({ text: basic });
                        return;
                    }
                }
            }
        } else {
            // Collect-all path: apply all filters, collect matches, then select by index
            const matches: Array<{ req: playwright.Request; res: playwright.Response | null; rendered: string }> = [];

            for (const req of resolvedRequests) {
                if (!matchesStructuredFilters(req, methodNorm, urlNorm, endpointNorm))
                    continue;

                if (queryParamsFilter.length > 0 && !matchesQueryParams(req, queryParamsFilter))
                    continue;

                if (reqHeadersFilter.length > 0 && !matchesFieldFilters(req.headers(), reqHeadersFilter))
                    continue;

                if (reqBodyFieldsFilter.length > 0) {
                    let postData: string | null;
                    try {
                        postData = req.postData();
                    } catch {
                        continue;
                    }
                    if (!matchesBodyFieldFilters(postData, reqBodyFieldsFilter))
                        continue;
                }

                const res = await req.response().catch(() => null);

                if (resHeadersFilter.length > 0) {
                    if (!res) continue;
                    const headers = await res.allHeaders().catch(() => ({}));
                    if (!matchesFieldFilters(headers, resHeadersFilter))
                        continue;
                }

                if (resBodyFieldsFilter.length > 0) {
                    if (!res) continue;
                    const bodyText = await res.text().catch(() => null);
                    if (!matchesBodyFieldFilters(bodyText, resBodyFieldsFilter))
                        continue;
                }

                let rendered: string;
                if (keywordsNorm.length > 0) {
                    try {
                        rendered = await renderRequestDetailed(req, res, logType);
                        if (hasBodyError(rendered)) continue;
                        if (!containsAllKeywords(rendered, keywordsNorm)) continue;
                    } catch {
                        rendered = renderRequest(req, res);
                        if (!containsAllKeywords(rendered, keywordsNorm)) continue;
                    }
                } else {
                    rendered = await safeRender(req, res, logType);
                    if (hasBodyError(rendered)) continue;
                }

                matches.push({ req, res, rendered });
            }

            if (matches.length > 0) {
                let selectedIdx: number;
                if (indexParam === undefined || indexParam === 'last') {
                    selectedIdx = matches.length - 1;
                } else if (indexParam === 'first') {
                    selectedIdx = 0;
                } else {
                    selectedIdx = indexParam;
                    if (selectedIdx < 0 || selectedIdx >= matches.length) {
                        throw new RequestsNotFound(
                            `Index ${selectedIdx} is out of range. Found ${matches.length} matching request(s) (valid indices: 0-${matches.length - 1}).`
                        );
                    }
                }
                response.addResult({ text: matches[selectedIdx].rendered });
                return;
            }
        }

        const parts: string[] = [];
        if (methodFilter) parts.push(`method="${methodFilter}"`);
        if (urlFilter) parts.push(`url~="${urlFilter}"`);
        if (endpointFilter) parts.push(`endpoint~="${endpointFilter}"`);
        if (keywords.length > 0) parts.push(`keywords=[${keywords.join(', ')}]`);
        if (queryParamsFilter.length > 0)
            parts.push(`queryParams=[${queryParamsFilter.map(f => `${f.name}${f.matchType === 'is_equal' ? '=' : '~='}${f.value}`).join(', ')}]`);
        if (reqHeadersFilter.length > 0)
            parts.push(`requestHeaders=[${reqHeadersFilter.map(f => `${f.name}${f.matchType === 'is_equal' ? '=' : '~='}${f.value}`).join(', ')}]`);
        if (resHeadersFilter.length > 0)
            parts.push(`responseHeaders=[${resHeadersFilter.map(f => `${f.name}${f.matchType === 'is_equal' ? '=' : '~='}${f.value}`).join(', ')}]`);
        if (reqBodyFieldsFilter.length > 0)
            parts.push(`requestBodyFields=[${reqBodyFieldsFilter.map(f => `${f.fieldPath}:${f.matchType}`).join(', ')}]`);
        if (resBodyFieldsFilter.length > 0)
            parts.push(`responseBodyFields=[${resBodyFieldsFilter.map(f => `${f.fieldPath}:${f.matchType}`).join(', ')}]`);

        throw new RequestsNotFound(
            `No network requests found that match filters (${parts.join(', ') || 'none'}) and contain ALL keywords.`
        );
    },
});

// ─── Structured filter helpers (original) ────────────────────────────────────

const REGEX_META = /[$^*+?.()|\\{}\[\]]/;

function toMatcher(filter: string): (value: string) => boolean {
    const regexMatch = filter.match(/^\/(.+)\/([gimsuy]*)$/);
    if (regexMatch) {
        try {
            const re = new RegExp(regexMatch[1], regexMatch[2]);
            return (value: string) => re.test(value);
        } catch {}
    }
    if (REGEX_META.test(filter)) {
        try {
            const re = new RegExp(filter);
            return (value: string) => re.test(value);
        } catch {}
    }
    return (value: string) => value.includes(filter);
}

function matchesStructuredFilters(
    request: playwright.Request,
    methodNorm?: string,
    urlNorm?: string,
    endpointNorm?: string
): boolean {
    if (methodNorm) {
        const reqMethod = (request.method() || '').trim();
        if (reqMethod !== methodNorm) return false;
    }

    if (urlNorm) {
        const reqUrl = request.url() || '';
        if (!toMatcher(urlNorm)(reqUrl)) return false;
    }

    if (endpointNorm) {
        const matcher = toMatcher(endpointNorm);
        try {
            const u = new URL(request.url());
            if (!matcher(u.pathname + u.search)) return false;
        } catch {
            const reqUrl = request.url() || '';
            if (!matcher(reqUrl)) return false;
        }
    }

    return true;
}

// ─── New filter helpers ──────────────────────────────────────────────────────

function matchFieldValue(actual: string, expected: string, matchType: 'is_equal' | 'contains' | 'exists'): boolean {
    if (matchType === 'exists') return true;
    if (matchType === 'is_equal') return actual === expected;
    if (matchType === 'contains') return actual.includes(expected);
    return false;
}

function matchesQueryParams(request: playwright.Request, filters: FieldFilter[]): boolean {
    let url: URL;
    try {
        url = new URL(request.url());
    } catch {
        return false;
    }
    return filters.every(filter => {
        const paramValues = url.searchParams.getAll(filter.name);
        if (paramValues.length === 0) return false;
        if (filter.matchType === 'exists') return true;
        return paramValues.some(val => matchFieldValue(val, filter.value ?? '', filter.matchType));
    });
}

function matchesFieldFilters(headers: Record<string, string>, filters: FieldFilter[]): boolean {
    return filters.every(filter => {
        const targetName = filter.name.toLowerCase();
        const headerValue = Object.entries(headers).find(
            ([key]) => key.toLowerCase() === targetName
        )?.[1];
        if (headerValue === undefined) return false;
        if (filter.matchType === 'exists') return true;
        return matchFieldValue(headerValue, filter.value ?? '', filter.matchType);
    });
}

function resolveFieldPath(obj: unknown, path: string): { found: boolean; value: unknown } {
    const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
    let current: unknown = obj;
    for (const part of parts) {
        if (current == null || typeof current !== 'object')
            return { found: false, value: undefined };
        if (!(part in (current as Record<string, unknown>)))
            return { found: false, value: undefined };
        current = (current as Record<string, unknown>)[part];
    }
    return { found: true, value: current };
}

function matchesBodyFieldFilters(bodyText: string | null, filters: BodyFieldFilter[]): boolean {
    if (!bodyText) return filters.length === 0;
    let parsed: unknown;
    try {
        parsed = JSON.parse(bodyText);
    } catch {
        return false;
    }
    return filters.every(filter => {
        const { found, value } = resolveFieldPath(parsed, filter.fieldPath);
        if (filter.matchType === 'exists') return found;
        if (!found) return false;
        const strValue = typeof value === 'string' ? value : JSON.stringify(value);
        if (filter.matchType === 'is_equal') return strValue === (filter.value ?? '');
        if (filter.matchType === 'contains') return strValue.includes(filter.value ?? '');
        return false;
    });
}

// ─── Render helpers (original) ───────────────────────────────────────────────

function hasBodyError(rendered: string): boolean {
    return rendered.includes('[Error accessing body:');
}

function containsAllKeywords(haystack: string, keywordsNorm: string[]): boolean {
    return keywordsNorm.every((kw) => haystack.includes(kw));
}

function renderRequest(request: playwright.Request, response: playwright.Response | null) {
    return JSON.stringify({
        method: request.method().toUpperCase(),
        url: request.url(),
        requestHeaders: null,
        responseHeaders: null,
        requestBody: null,
        responseBody: null,
    }, null, 2);
}

async function safeRender(
    request: playwright.Request,
    response: playwright.Response | null,
    logType: LogType
): Promise<string> {
    try {
        return await renderRequestDetailed(request, response, logType);
    } catch (error) {
        return JSON.stringify({
            method: request.method().toUpperCase(),
            url: request.url(),
            requestHeaders: null,
            responseHeaders: null,
            requestBody: null,
            responseBody: null,
            error: `Error rendering detailed request: ${error}`,
        }, null, 2);
    }
}

async function renderRequestDetailed(
    request: playwright.Request,
    response: playwright.Response | null,
    logType: LogType
) {
    const result: {
        method: string;
        url: string;
        requestHeaders: Record<string, string> | null;
        responseHeaders: Record<string, string> | null;
        requestBody: string | null;
        responseBody: string | null;
    } = {
        method: request.method().toUpperCase(),
        url: request.url(),
        requestHeaders: null,
        responseHeaders: null,
        requestBody: null,
        responseBody: null,
    };

    if (logType.request.headers) {
        const requestHeaders = request.headers();
        if (Object.keys(requestHeaders).length > 0) {
            result.requestHeaders = requestHeaders;
        }
    }

    if (logType.request.body) {
        try {
            const requestBody = request.postData();
            if (requestBody) {
                result.requestBody = requestBody;
            }
        } catch (error) {
            result.requestBody = `[Error accessing body: ${error}]`;
        }
    }

    if (response && logType.response.headers) {
        try {
            const responseHeaders = await response.allHeaders();
            if (Object.keys(responseHeaders).length > 0) {
                result.responseHeaders = responseHeaders;
            }
        } catch (error) {
            // Keep as null if error occurs
        }
    }

    if (response && logType.response.body) {
        try {
            const responseBody = await response.text();
            if (responseBody) {
                const contentType = (await response.allHeaders())['content-type'] || '';
                if (contentType.includes('image/') || contentType.includes('application/octet-stream')) {
                    result.responseBody = `[Binary content - ${contentType}] (${responseBody.length} bytes)`;
                } else {
                    result.responseBody = responseBody;
                }
            }
        } catch (error) {
            result.responseBody = `[Error accessing body: ${error}]`;
        }
    }

    return JSON.stringify(result, null, 2);
}

export default [otto_requests];
