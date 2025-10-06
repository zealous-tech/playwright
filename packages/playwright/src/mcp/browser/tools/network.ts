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

/*
*
*  @ZEALOUS UPDATE - updated network request extraction to provide all data with additional filtering
*
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
  url?: string;      // full or partial URL substring, case-insensitive, or regex pattern
  endpoint?: string; // pathname substring, e.g. "/api/users", case-insensitive, or regex pattern
  keywords?: string[];
  logType?: LogType;
  useRegex?: boolean; // if true, treat url and endpoint as regex patterns
};

const requests = defineTabTool({
  capability: 'core',

  schema: {
    name: 'browser_network_requests',
    title: 'Find specific network request',
    description:
      'Search network request logs and return exactly ONE entry that satisfies structured filters (method/url/endpoint) AND contains ALL specified keywords. Keywords are searched across method, URL, headers, and bodies (case-insensitive). Use logType to control which fields are included in the output. For full URLs like "https://example.com/api/books", use the "url" parameter. For path-only matching like "/api/books", use the "endpoint" parameter.',
    inputSchema: z.object({
      method: z
        .string()
        .optional()
        .describe('HTTP method to match (e.g., "GET"). Case-insensitive exact token match.'),
      url: z
        .string()
        .optional()
        .describe('Full or partial URL to match including protocol and domain (e.g., "https://demoqa.com/BookStore/v1/Books"). Uses substring matching (case-insensitive). Can be a regex pattern if useRegex is true.'),
      endpoint: z
        .string()
        .optional()
        .describe('Pathname with optional query params to match (e.g., "/BookStore/v1/Books" or "/api/users?id=123"). Uses path boundary matching to ensure "/book" does not match "/books" (case-insensitive). Can be a regex pattern if useRegex is true.'),
      keywords: z
        .array(z.string())
        .default([])
        .describe('Array of keywords that must ALL be present somewhere in the request/response data (case-insensitive).'),
      useRegex: z
        .boolean()
        .optional()
        .default(false)
        .describe('If true, treat url and endpoint parameters as regular expression patterns. Defaults to false.'),
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
      useRegex = false,
    } = params;

    const logType: LogType =
      params.logType || {
        request: { headers: false, body: false },
        response: { headers: false, body: false },
      };

    const methodNorm = methodFilter?.trim().toLowerCase();
    const urlNorm = urlFilter?.trim();
    const endpointNorm = endpointFilter?.trim();
    const keywordsLower = keywords.map((k) => k.toLowerCase());

    for (const [req, res] of allRequests.entries()) {
      if (!matchesStructuredFilters(req, methodNorm, urlNorm, endpointNorm, useRegex)) {
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

/**
 * Helper function to match paths with proper boundary checks.
 * Ensures /endpoint doesn't match /endpoints, but allows flexible matching for query params.
 *
 * Examples:
 * - matchesPathWithBoundaries("/api/endpoint", "/api/endpoint") => true
 * - matchesPathWithBoundaries("/api/endpoint?id=1", "/api/endpoint") => true
 * - matchesPathWithBoundaries("/api/endpoints", "/api/endpoint") => false
 * - matchesPathWithBoundaries("/api/endpoint/123", "/api/endpoint") => true
 */
function matchesPathWithBoundaries(fullPath: string, searchPattern: string): boolean {
  const fullPathLower = fullPath.toLowerCase();
  const searchLower = searchPattern.toLowerCase();

  // Find the position of the search pattern in the full path
  const index = fullPathLower.indexOf(searchLower);

  if (index === -1) {
    return false; // Pattern not found
  }

  // Check what comes BEFORE the match (must be start of string or a boundary character)
  if (index > 0) {
    const beforeMatch = fullPathLower.charAt(index - 1);
    // Valid boundaries before: '/', '?', '#', or start of string
    const isValidBefore = beforeMatch === '/' || beforeMatch === '?' || beforeMatch === '#';
    if (!isValidBefore) {
      return false; // Pattern found in the middle of a word
    }
  }

  // Check what comes after the match
  const afterMatch = fullPathLower.substring(index + searchLower.length);

  // Match is valid if:
  // 1. Nothing comes after (exact match)
  // 2. Next character is '/' (path continues with another segment)
  // 3. Next character is '?' (query parameters start)
  // 4. Next character is '#' (fragment starts)
  return afterMatch === '' ||
         afterMatch.startsWith('/') ||
         afterMatch.startsWith('?') ||
         afterMatch.startsWith('#');
}

function matchesStructuredFilters(
  request: playwright.Request,
  methodNorm?: string,
  urlNorm?: string,
  endpointNorm?: string,
  useRegex: boolean = false
): boolean {
  const requestUrl = request.url();

  if (methodNorm) {
    const reqMethod = (request.method() || '').trim().toLowerCase();
    if (reqMethod !== methodNorm) return false;
  }

  if (urlNorm) {
    const reqUrl = requestUrl || '';
    if (useRegex) {
      try {
        const regex = new RegExp(urlNorm, 'i'); // case-insensitive
        const match = regex.exec(reqUrl);
        if (!match) return false;

        // Check boundaries: ensure the match doesn't continue into another path segment
        const matchEnd = match.index + match[0].length;
        if (matchEnd < reqUrl.length) {
          const nextChar = reqUrl.charAt(matchEnd);
          // Valid boundaries after match: '/', '?', '#', or end of string
          const isValidBoundary = nextChar === '/' || nextChar === '?' || nextChar === '#';
          if (!isValidBoundary) return false;
        }
      } catch (e) {
        // Fallback to boundary match if regex is invalid
        if (!matchesPathWithBoundaries(reqUrl, urlNorm)) return false;
      }
    } else {
      // Use boundary matching for URLs to prevent partial matches (e.g., /book shouldn't match /books)
      if (!matchesPathWithBoundaries(reqUrl, urlNorm)) return false;
    }
  }

  if (endpointNorm) {
    // Normalize endpoint to ensure it starts with / if it's a path (not a full URL)
    const normalizedEndpoint = endpointNorm.startsWith('/') || endpointNorm.includes('://')
      ? endpointNorm
      : '/' + endpointNorm;

    try {
      const u = new URL(requestUrl);
      const pathname = u.pathname || '';
      const fullPath = pathname + u.search; // Include query parameters

      if (useRegex) {
        try {
          const regex = new RegExp(normalizedEndpoint, 'i'); // case-insensitive
          const match = regex.exec(fullPath);
          if (!match) return false;

          // Check boundaries: ensure the match doesn't continue into another path segment
          const matchEnd = match.index + match[0].length;
          if (matchEnd < fullPath.length) {
            const nextChar = fullPath.charAt(matchEnd);
            // Valid boundaries after match: '/', '?', '#', or end of string
            const isValidBoundary = nextChar === '/' || nextChar === '?' || nextChar === '#';
            if (!isValidBoundary) return false;
          }
        } catch (e) {
          if (!matchesPathWithBoundaries(fullPath, normalizedEndpoint)) return false;
        }
      } else {
        if (!matchesPathWithBoundaries(fullPath, normalizedEndpoint)) return false;
      }
    } catch {
      const reqUrl = requestUrl || '';
      if (useRegex) {
        try {
          const regex = new RegExp(normalizedEndpoint, 'i');
          const match = regex.exec(reqUrl);
          if (!match) return false;

          // Check boundaries: ensure the match doesn't continue into another path segment
          const matchEnd = match.index + match[0].length;
          if (matchEnd < reqUrl.length) {
            const nextChar = reqUrl.charAt(matchEnd);
            // Valid boundaries after match: '/', '?', '#', or end of string
            const isValidBoundary = nextChar === '/' || nextChar === '?' || nextChar === '#';
            if (!isValidBoundary) return false;
          }
        } catch (e) {
          if (!matchesPathWithBoundaries(reqUrl, normalizedEndpoint)) return false;
        }
      } else {
        if (!matchesPathWithBoundaries(reqUrl, normalizedEndpoint)) return false;
      }
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
