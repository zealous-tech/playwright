/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {z} from 'zod';
import {defineTabTool} from './tool.js';

import type * as playwright from 'playwright';

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

type Input = {
  method?: string;   // e.g. "GET" (case-insensitive, exact match on token)
  url?: string;      // full or partial URL substring, case-insensitive
  endpoint?: string; // pathname substring, e.g. "/api/users", case-insensitive
  keywords?: string[];
  logType?: LogType;
};

const requests = defineTabTool({
  capability: 'core',

  schema: {
    name: 'browser_network_requests',
    title: 'Find specific network request',
    description:
      'Search network request logs and return exactly ONE entry that satisfies structured filters (method/url/endpoint) AND contains ALL specified keywords. Keywords are searched across method, URL, headers, and bodies (case-insensitive). Use logType to control which fields are included in the output.',
    inputSchema: z.object({
      method: z
        .string()
        .optional()
        .describe('HTTP method to match (e.g., "GET"). Case-insensitive exact token match.'),
      url: z
        .string()
        .optional()
        .describe('Full or partial URL to match (substring, case-insensitive).'),
      endpoint: z
        .string()
        .optional()
        .describe('Pathname to match (substring of URL pathname, e.g., "/api/users", case-insensitive).'),
      keywords: z
        .array(z.string())
        .default([])
        .describe('Array of keywords that must ALL be present somewhere in the request/response data (case-insensitive).'),
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
    } = params;

    const logType: LogType =
      params.logType || {
        request: { headers: false, body: false },
        response: { headers: false, body: false },
      };

    const methodNorm = methodFilter?.trim().toLowerCase();
    const urlNorm = urlFilter?.trim().toLowerCase();
    const endpointNorm = endpointFilter?.trim().toLowerCase();
    const keywordsLower = keywords.map((k) => k.toLowerCase());

    for (const [req, res] of allRequests.entries()) {
      if (!matchesStructuredFilters(req, methodNorm, urlNorm, endpointNorm)) {
        continue;
      }
      if (keywordsLower.length === 0) {
        const out = await safeRender(req, res, logType);
        response.addResult(out);
        return;
      }

      try {
        const detailed = await renderRequestDetailed(req, res, logType);
        const hasAll = containsAllKeywords(detailed, keywordsLower);
        if (hasAll) {
          response.addResult(detailed);
          return;
        }
      } catch {
        const basic = renderRequest(req, res);
        const hasAll = containsAllKeywords(basic, keywordsLower);
        if (hasAll) {
          response.addResult(basic);
          return;
        }
      }
    }

    const parts: string[] = [];
    if (methodFilter) parts.push(`method="${methodFilter}"`);
    if (urlFilter) parts.push(`url~="${urlFilter}"`);
    if (endpointFilter) parts.push(`endpoint~="${endpointFilter}"`);
    if (keywords.length > 0) parts.push(`keywords=[${keywords.join(', ')}]`);

    throw new Error(
      `No network requests found that match filters (${parts.join(', ') || 'none'}) and contain ALL keywords.`
    );
  },
});

function matchesStructuredFilters(
  request: playwright.Request,
  methodNorm?: string,
  urlNorm?: string,
  endpointNorm?: string
): boolean {
  if (methodNorm) {
    const reqMethod = (request.method() || '').trim().toLowerCase();
    if (reqMethod !== methodNorm) return false;
  }

  if (urlNorm) {
    const reqUrl = (request.url() || '').toLowerCase();
    if (!reqUrl.includes(urlNorm)) return false;
  }

  if (endpointNorm) {
    try {
      const u = new URL(request.url());
      const pathname = (u.pathname || '').toLowerCase();
      if (!pathname.includes(endpointNorm)) return false;
    } catch {
      const reqUrl = (request.url() || '').toLowerCase();
      if (!reqUrl.includes(endpointNorm)) return false;
    }
  }

  return true;
}

function containsAllKeywords(haystack: string, keywordsLower: string[]): boolean {
  const text = haystack.toLowerCase();
  return keywordsLower.every((kw) => text.includes(kw));
}

function renderRequest(request: playwright.Request, response: playwright.Response | null) {
  const result: string[] = [];
  result.push(`[${request.method().toUpperCase()}] ${request.url()}`);
  if (response) result.push(`=> [${response.status()}] ${response.statusText()}`);
  return result.join(' ');
}

async function safeRender(
  request: playwright.Request,
  response: playwright.Response | null,
  logType: LogType
): Promise<string> {
  try {
    return await renderRequestDetailed(request, response, logType);
  } catch {
    return renderRequest(request, response);
  }
}

async function renderRequestDetailed(
  request: playwright.Request,
  response: playwright.Response | null,
  logType: LogType
) {
  const result: string[] = [];

  result.push(`=== REQUEST ===`);
  result.push(`Method: ${request.method().toUpperCase()}`);
  result.push(`URL: ${request.url()}`);

  if (logType.request.headers) {
    const requestHeaders = request.headers();
    if (Object.keys(requestHeaders).length > 0) {
      result.push(`\nRequest Headers:`);
      for (const [key, value] of Object.entries(requestHeaders)) {
        result.push(`  ${key}: ${value}`);
      }
    }
  }

  if (logType.request.body) {
    try {
      const requestBody = request.postData();
      if (requestBody) {
        result.push(`\nRequest Body:\n${requestBody}`);
      }
    } catch (error) {
      result.push(`\nRequest Body: [Error accessing body: ${error}]`);
    }
  }

  result.push(`\n=== RESPONSE ===`);
  if (response) {
    result.push(`Status: ${response.status()} ${response.statusText()}`);

    if (logType.response.headers) {
      try {
        const responseHeaders = await response.allHeaders();
        if (Object.keys(responseHeaders).length > 0) {
          result.push(`\nResponse Headers:`);
          for (const [key, value] of Object.entries(responseHeaders)) {
            result.push(`  ${key}: ${value}`);
          }
        }
      } catch (error) {
        result.push(`\nResponse Headers: [Error accessing headers: ${error}]`);
      }
    }

    if (logType.response.body) {
      try {
        const responseBody = await response.text();
        if (responseBody) {
          result.push(`\nResponse Body:`);
          const contentType = (await response.allHeaders())['content-type'] || '';
          if (contentType.includes('image/') || contentType.includes('application/octet-stream')) {
            result.push(`  [Binary content - ${contentType}] (${responseBody.length} bytes)`);
          } else {
            result.push(`  ${responseBody}`);
          }
        }
      } catch (error) {
        result.push(`\nResponse Body: [Error accessing body: ${error}]`);
      }
    }
  } else {
    result.push(`Status: [No response received]`);
  }

  return result.join('\n');
}

export default [requests];
