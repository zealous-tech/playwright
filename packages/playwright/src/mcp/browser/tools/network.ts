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

const requests = defineTabTool({
  capability: 'core',

  schema: {
    name: 'browser_network_requests',
    title: 'Find specific network request',
    description: 'Searches through network request logs and returns exactly ONE request that contains ALL specified keywords. Searches across method, URL, headers, and body content (case-insensitive). Use logType to control what information is included in the output - useful for extracting specific data like headers, body content, etc.',
    inputSchema: z.object({
      keywords: z.array(z.string()).min(1).describe('Array of keywords that must ALL be present in the request/response data. Returns the first request containing all keywords (e.g., ["GET", "api/users", "authorization"]).'),
      logType: z.object({
        request: z.object({
          headers: z.boolean().default(true).describe('Include request headers in output'),
          body: z.boolean().default(true).describe('Include request body in output')
        }).default({headers: true, body: true}),
        response: z.object({
          headers: z.boolean().default(true).describe('Include response headers in output'),
          body: z.boolean().default(true).describe('Include response body in output')
        }).default({headers: true, body: true})
      }).optional().describe('Controls what information to include in the output. If not provided, includes nothing')
    }),
    type: 'readOnly',
  },

  handle: async (tab, params, response) => {
    const requests = tab.requests();
    const keywordsLower = params.keywords.map(keyword => keyword.toLowerCase());
    const logType = params.logType || {
      request: {headers: false, body: false},
      response: {headers: false, body: false}
    };

    for (const [req, res] of requests.entries()) {
      try {
        const requestDetails = await renderRequestDetailed(req, res, logType);
        const requestDetailsLower = requestDetails.toLowerCase();

        const hasAllKeywords = keywordsLower.every(keyword =>
          requestDetailsLower.includes(keyword)
        );

        if (hasAllKeywords) {
          response.addResult(requestDetails);
          return;
        }
      } catch (error) {
        const basicDetails = renderRequest(req, res);
        const basicDetailsLower = basicDetails.toLowerCase();

        const hasAllKeywords = keywordsLower.every(keyword =>
          basicDetailsLower.includes(keyword)
        );

        if (hasAllKeywords) {
          response.addResult(basicDetails);
          return;
        }
      }
    }
    throw new Error(`No network requests found containing ALL keywords: [${params.keywords.join(', ')}]`);
  },
});

function renderRequest(request: playwright.Request, response: playwright.Response | null) {
  const result: string[] = [];
  result.push(`[${request.method().toUpperCase()}] ${request.url()}`);
  if (response)
    result.push(`=> [${response.status()}] ${response.statusText()}`);
  return result.join(' ');
}

async function renderRequestDetailed(request: playwright.Request, response: playwright.Response | null, logType: LogType) {
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

  if (response) {
    result.push(`\n=== RESPONSE ===`);
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
    result.push(`\n=== RESPONSE ===`);
    result.push(`Status: [No response received]`);
  }
  return result.join('\n');
}

export default [
  requests,
];
