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

import { z } from '../../sdk/bundle';
import { defineTabTool } from './tool';
import * as javascript from '../codegen';

import type { Tab } from '../tab';
import type * as playwright from 'playwright-core';

const evaluateSchema = z.object({
  function: z.string().describe('() => { /* code */ } or (element) => { /* code */ } when element is provided'),
  element: z.string().optional().describe('Human-readable element description used to obtain permission to interact with the element'),
  ref: z.string().optional().describe('Exact target element reference from the page snapshot'),
});

const evaluate = defineTabTool({
  capability: 'core',
  schema: {
    name: 'browser_evaluate',
    title: 'Evaluate JavaScript',
    description: 'Evaluate JavaScript expression on page or element',
    inputSchema: evaluateSchema,
    type: 'action',
  },

  handle: async (tab, params, response) => {
    response.setIncludeSnapshot();

    let locator: playwright.Locator | undefined;
    if (params.ref && params.element) {
      locator = await tab.refLocator({ ref: params.ref, element: params.element });
      // Generate locator string for code display
      try {
        const { resolvedSelector } = await (locator as any)._resolveSelector();
        const locatorCode = `locator('${resolvedSelector}')`;
        response.addCode(`await page.${locatorCode}.evaluate(${javascript.quote(params.function)});`);
      } catch (e) {
        response.addCode(`await page.locator('aria-ref=${params.ref}').evaluate(${javascript.quote(params.function)});`);
      }
    } else {
      response.addCode(`await page.evaluate(${javascript.quote(params.function)});`);
    }

    await tab.waitForCompletion(async () => {
      // Evaluate the function - use eval to convert string to actual function
      let result;
      try {
        if (locator) {
          // For element evaluation, create a function that takes element as parameter
          // The function string should be like "(element) => { ... }"
          const evalFunc = eval(`(${params.function})`);
          result = await locator.evaluate(evalFunc);
        } else {
          // For page evaluation, create a function with no parameters
          // The function string should be like "() => { ... }"
          const evalFunc = eval(`(${params.function})`);
          result = await tab.page.evaluate(evalFunc);
        }
      } catch (error) {
        response.addError(`Evaluation failed: ${error instanceof Error ? error.message : String(error)}`);
        return;
      }
      
      // Check if result is already a JSON string (some functions return JSON.stringify'd values)
      let finalResult;
      if (typeof result === 'string') {
        try {
          // Try to parse it - if it's valid JSON, use as is
          JSON.parse(result);
          finalResult = result;
        } catch (e) {
          // Not valid JSON, stringify it
          finalResult = JSON.stringify(result);
        }
      } else {
        // Result is an object/value, stringify it
        finalResult = JSON.stringify(result);
      }
      
      // Return wrapped in quotes for proper parsing by parseToolResult
      response.addResult(`"${finalResult.replace(/"/g, '\\"')}"`);
    });
  },
});

export default [
  evaluate,
];
