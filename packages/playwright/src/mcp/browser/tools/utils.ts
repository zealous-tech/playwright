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

import { asLocator } from 'playwright-core/lib/utils';

import type * as playwright from 'playwright-core';
import type { Tab } from '../tab';

export async function waitForCompletion<R>(tab: Tab, callback: () => Promise<R>): Promise<R> {
  const requests = new Set<playwright.Request>();
  let frameNavigated = false;
  let waitCallback: () => void = () => {};
  const waitBarrier = new Promise<void>(f => { waitCallback = f; });

  const responseListener = (request: playwright.Request) => {
    requests.delete(request);
    if (!requests.size)
      waitCallback();
  };

  const requestListener = (request: playwright.Request) => {
    requests.add(request);
    void request.response().then(() => responseListener(request)).catch(() => {});
  };

  const frameNavigateListener = (frame: playwright.Frame) => {
    if (frame.parentFrame())
      return;
    frameNavigated = true;
    dispose();
    clearTimeout(timeout);
    void tab.waitForLoadState('load').then(waitCallback);
  };

  const onTimeout = () => {
    dispose();
    waitCallback();
  };

  tab.page.on('request', requestListener);
  tab.page.on('requestfailed', responseListener);
  tab.page.on('framenavigated', frameNavigateListener);
  const timeout = setTimeout(onTimeout, 10000);

  const dispose = () => {
    tab.page.off('request', requestListener);
    tab.page.off('requestfailed', responseListener);
    tab.page.off('framenavigated', frameNavigateListener);
    clearTimeout(timeout);
  };

  try {
    const result = await callback();
    if (!requests.size && !frameNavigated)
      waitCallback();
    await waitBarrier;
    //ZEALOUS UPDATE setting this to 1 second to avoid waiting for the timeout
    //await tab.waitForTimeout(1000);
    await new Promise(f => setTimeout(f, 1000));
    return result;
  } finally {
    dispose();
  }
}

export async function generateLocator(locator: playwright.Locator): Promise<string> {
  // Get caller function name from stack trace
  const stack = new Error().stack;
  let callerInfo = 'unknown';
  if (stack) {
    const stackLines = stack.split('\n');
    // Skip first line (Error), second line (generateLocator), third line should be the caller
    if (stackLines.length > 2) {
      const callerLine = stackLines[2].trim();
      // Try to extract function name: could be "at functionName" or "at Object.functionName" or "at ClassName.methodName"
      const match = callerLine.match(/at\s+(?:new\s+)?(?:Object\.)?(\w+)(?:\.(\w+))?/);
      if (match) {
        callerInfo = match[2] ? `${match[1]}.${match[2]}` : match[1];
      } else {
        callerInfo = callerLine;
      }
    }
  }
  console.log(`[generateLocator] Called from function: ${callerInfo}`);
  try {
    const { resolvedSelector } = await (locator as any)._resolveSelector();
    return asLocator('javascript', resolvedSelector);
  } catch (e) {
    console.error('Ref not found, likely because element was removed. Use browser_snapshot to see what elements are currently on the page.', e);
    return "error:notfound";
  }
}

export async function callOnPageNoTrace<T>(page: playwright.Page, callback: (page: playwright.Page) => Promise<T>): Promise<T> {
  return await (page as any)._wrapApiCall(() => callback(page), { internal: true });
}

export function dateAsFileName(extension: string): string {
  const date = new Date();
  return `page-${date.toISOString().replace(/[:.]/g, '-')}.${extension}`;
}
