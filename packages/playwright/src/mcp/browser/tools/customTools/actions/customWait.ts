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
import { defineTool } from '../../tool';
import { customWaitSchema } from '../helpers/schemas';

export const custom_wait = defineTool({
  capability: 'core',
  schema: {
    name: 'browser_wait_for_text',
    title: 'Wait for',
    description: 'Wait for text to appear or disappear with optional maximum timeout',
    inputSchema: customWaitSchema,
    type: 'assertion',
  },
  handle: async (context, params, response) => {
    if (!params.text && !params.textGone && !params.time)
      throw new Error('Either time, text or textGone must be provided');

    const tab = context.currentTabOrDie();
    const actionTimeout = params.time ? params.time * 1000 : context.config.timeouts.action;

    // Helper function to wait for text in all frames using waitForFunction
    // Uses recursive search to find text in main frame and all nested iframes
    // Automatically handles dynamically appearing iframes
    // Returns information about which frame the text was found in
    const waitForTextInFrames = async (text: string, state: 'visible' | 'hidden') => {
      const shouldBeVisible = state === 'visible';

      const result = await tab.page.waitForFunction(
          ({ searchText, checkVisible }) => {
          // Recursive function to search in window and all nested frames
          // Returns frame info if found, null if not found
            const searchInWindow = (win: Window, path: string): { success: true; frameName: string } | null => {
              try {
              // Check current window's document
                const doc = win.document;
                const bodyText = doc && doc.body ? doc.body.innerText : '';
                if (bodyText.includes(searchText)) {
                // Build frame identifier
                  const frameName = path || 'main';
                  return { success: true, frameName };
                }

                // Recursively check all child frames (including dynamically added ones)
                const frames = win.frames;
                for (let i = 0; i < frames.length; i++) {
                  try {
                    const childPath = path ? `${path} > iframe[${i}]` : `iframe[${i}]`;
                    const childResult = searchInWindow(frames[i], childPath);
                    if (childResult)
                      return childResult;

                  } catch {
                  // Cross-origin iframe - can't access, skip
                  }
                }

                return null;
              } catch {
                return null;
              }
            };

            const searchResult = searchInWindow(window, '');

            if (checkVisible) {
            // For visible: return frame info when text IS found
              return searchResult;
            } else {
            // For hidden: return success when text is NOT found anywhere
              return searchResult === null ? { success: true, frameName: 'none (text gone)' } : null;
            }
          },
          { searchText: text, checkVisible: shouldBeVisible },
          { timeout: actionTimeout }
      );

      // Extract the result from the JSHandle
      const frameInfo = await result.jsonValue() as { success: boolean; frameName: string };
      return { success: true, frame: frameInfo.frameName };
    };

    let foundFrame: string | null = null;

    if (params.textGone) {
      response.addCode(`await page.waitForFunction(({ text }) => !document.body.innerText.includes(text), { text: ${JSON.stringify(params.textGone)} });`);
      const result = await waitForTextInFrames(params.textGone, 'hidden');
      foundFrame = result.frame;
    }

    if (params.text) {
      response.addCode(`await page.waitForFunction(({ text }) => document.body.innerText.includes(text), { text: ${JSON.stringify(params.text)} });`);
      const result = await waitForTextInFrames(params.text, 'visible');
      foundFrame = result.frame;
    }

    const frameInfo = foundFrame && foundFrame !== 'main' ? ` (found in ${foundFrame})` : '';
    response.addResult(`Waited for ${params.text || params.textGone || params.time}${frameInfo}`);
    response.setIncludeSnapshot();
  },
});
