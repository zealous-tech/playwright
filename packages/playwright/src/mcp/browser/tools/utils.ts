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

import type * as playwright from 'playwright-core';
import type { Tab } from '../tab';
import { asLocator } from 'playwright-core/lib/utils';
export async function waitForCompletion<R>(tab: Tab, callback: () => Promise<R>): Promise<R> {
  const requests: playwright.Request[] = [];

  const requestListener = (request: playwright.Request) => requests.push(request);
  const disposeListeners = () => {
    tab.page.off('request', requestListener);
  };
  tab.page.on('request', requestListener);

  let result: R;
  try {
    result = await callback();
    await tab.waitForTimeout(500);
  } finally {
    disposeListeners();
  }

  const requestedNavigation = requests.some(request => request.isNavigationRequest());
  if (requestedNavigation) {
    await tab.page.mainFrame().waitForLoadState('load', { timeout: 10000 }).catch(() => {});
    return result;
  }

  const promises: Promise<any>[] = [];
  for (const request of requests) {
    if (['document', 'stylesheet', 'script', 'xhr', 'fetch'].includes(request.resourceType()))
      promises.push(request.response().then(r => r?.finished()).catch(() => {}));
    else
      promises.push(request.response().catch(() => {}));
  }
  const timeout = new Promise<void>(resolve => setTimeout(resolve, 5000));
  await Promise.race([Promise.all(promises), timeout]);
  if (requests.length)
    await tab.waitForTimeout(500);

  return result;
}

export async function callOnPageNoTrace<T>(page: playwright.Page, callback: (page: playwright.Page) => Promise<T>): Promise<T> {
  return await (page as any)._wrapApiCall(() => callback(page), { internal: true });
}

export function dateAsFileName(extension: string): string {
  const date = new Date();
  return `page-${date.toISOString().replace(/[:.]/g, '-')}.${extension}`;
}

export function eventWaiter<T>(page: playwright.Page, event: string, timeout: number): { promise: Promise<T | undefined>, abort: () => void } {
  const disposables: (() => void)[] = [];

  const eventPromise = new Promise<T | undefined>((resolve, reject) => {
    page.on(event as any, resolve as any);
    disposables.push(() => page.off(event as any, resolve as any));
  });

  let abort: () => void;
  const abortPromise = new Promise<T | undefined>((resolve, reject) => {
    abort = () => resolve(undefined);
  });

  const timeoutPromise = new Promise<T | undefined>(f => {
    const timeoutId = setTimeout(() => f(undefined), timeout);
    disposables.push(() => clearTimeout(timeoutId));
  });

  return {
    promise: Promise.race([eventPromise, abortPromise, timeoutPromise]).finally(() => disposables.forEach(dispose => dispose())),
    abort: abort!
  };
}

export async function generateLocator(locator: playwright.Locator, preferCssSelector: boolean = false): Promise<string> {
  try {
    const { resolvedSelector } = await (locator as any)._resolveSelector();
    const generated = asLocator('javascript', resolvedSelector);

    // For default_validation: fall back to a more stable CSS/xpath selector when getByText is generated
    if (preferCssSelector && generated.startsWith('getByText(')) {
      const fallbackSelector = await locator.evaluate((el: Element) => {
        // 1. Best: id-based selector
        if (el.id)
          return `#${CSS.escape(el.id)}`;

        // 2. data-testid attribute
        const testId = el.getAttribute('data-testid') || el.getAttribute('data-test-id') || el.getAttribute('data-test');
        if (testId)
          return `[data-testid="${testId}"]`;

        // 3. Tag + unique combination of meaningful attributes (name, type, aria-label, role, href)
        const tag = el.tagName.toLowerCase();
        const attrs: string[] = [];
        for (const attr of ['name', 'type', 'aria-label', 'role', 'href', 'for', 'value', 'placeholder', 'title', 'alt']) {
          const val = el.getAttribute(attr);
          if (val)
            attrs.push(`[${attr}="${val}"]`);
        }
        if (attrs.length > 0) {
          const candidate = `${tag}${attrs.join('')}`;
          // Verify uniqueness in the document
          if (document.querySelectorAll(candidate).length === 1)
            return candidate;
        }

        // 4. Tag + class combination if unique
        if (el.className && typeof el.className === 'string') {
          const classes = el.className.trim().split(/\s+/).filter(c => c.length > 0);
          if (classes.length > 0) {
            const classSelector = `${tag}.${classes.map(c => CSS.escape(c)).join('.')}`;
            if (document.querySelectorAll(classSelector).length === 1)
              return classSelector;
          }
        }

        // 5. Last resort: xpath
        function getXPath(element: Element): string {
          if (element.id !== '')
            return '//*[@id="' + element.id + '"]';
          if (element === document.body)
            return '/html/body';
          let ix = 0;
          const siblings = element.parentNode ? Array.from(element.parentNode.children) : [];
          for (let i = 0; i < siblings.length; i++) {
            const sibling = siblings[i];
            if (sibling === element)
              return getXPath(element.parentNode as Element) + '/' + element.tagName.toLowerCase() + '[' + (ix + 1) + ']';
            if (sibling.nodeType === 1 && sibling.tagName === element.tagName)
              ix++;
          }
          return '';
        }
        return 'xpath=' + getXPath(el);
      });

      // If it's an xpath, wrap with the xpath= prefix for asLocator; otherwise treat as CSS
      const selector = fallbackSelector.startsWith('xpath=') ? fallbackSelector : `css=${fallbackSelector}`;
      return asLocator('javascript', selector);
    }

    return generated;
  } catch (e) {
    console.error('Ref not found, likely because element was removed. Use browser_snapshot to see what elements are currently on the page.', e);
    return "UI Element not found";
  }
}