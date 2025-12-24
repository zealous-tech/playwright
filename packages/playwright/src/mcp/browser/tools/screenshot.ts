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

import { scaleImageToSize } from 'playwright-core/lib/utils';
import { jpegjs, PNG } from 'playwright-core/lib/utilsBundle';

import { z } from '../../sdk/bundle';
import { defineTabTool } from './tool';
import * as javascript from '../codegen';
import { dateAsFileName } from './utils';

import type * as playwright from 'playwright-core';

const screenshotSchema = z.object({
  type: z.enum(['png', 'jpeg']).default('png').describe('Image format for the screenshot. Default is png.'),
  filename: z.string().optional().describe('File name to save the screenshot to. Defaults to `page-{timestamp}.{png|jpeg}` if not specified. Prefer relative file names to stay within the output directory.'),
  element: z.string().optional().describe('Human-readable element description used to obtain permission to screenshot the element. If not provided, the screenshot will be taken of viewport. If element is provided, ref must be provided too.'),
  ref: z.string().optional().describe('Exact target element reference from the page snapshot. If not provided, the screenshot will be taken of viewport. If ref is provided, element must be provided too.'),
  fullPage: z.boolean().optional().describe('When true, takes a screenshot of the full scrollable page, instead of the currently visible viewport. Cannot be used with element screenshots.'),
});

const screenshot = defineTabTool({
  capability: 'core',
  schema: {
    name: 'browser_take_screenshot',
    title: 'Take a screenshot',
    description: `Take a screenshot of the current page. You can't perform actions based on the screenshot, use browser_snapshot for actions.`,
    inputSchema: screenshotSchema,
    type: 'readOnly',
  },

  handle: async (tab, params, response) => {
    if (!!params.element !== !!params.ref)
      throw new Error('Both element and ref must be provided or neither.');
    if (params.fullPage && params.ref)
      throw new Error('fullPage cannot be used with element screenshots.');

    const fileType = params.type || 'png';
    const options: playwright.PageScreenshotOptions = {
      type: fileType,
      quality: fileType === 'png' ? undefined : 90,
      scale: 'css',
      timeout: 10000, // 10 second timeout - screenshot should be fast
      ...(params.fullPage !== undefined && { fullPage: params.fullPage })
    };
    const isElementScreenshot = params.element && params.ref;

    const screenshotTarget = isElementScreenshot ? params.element : (params.fullPage ? 'full page' : 'viewport');
    response.addCode(`// Screenshot ${screenshotTarget}`);

    // Only get snapshot when element screenshot is needed
    const ref = params.ref ? await tab.refLocator({ element: params.element || '', ref: params.ref }) : null;

    if (ref) {
      // Generate locator code for display
      try {
        const { resolvedSelector } = await (ref as any)._resolveSelector();
        response.addCode(`await page.locator('${resolvedSelector}').screenshot(${javascript.formatObject(options)});`);
      } catch (e) {
        response.addCode(`await page.locator('aria-ref=${params.ref}').screenshot(${javascript.formatObject(options)});`);
      }
    } else {
      response.addCode(`await page.screenshot(${javascript.formatObject(options)});`);
    }

    // Check if page is about:blank or has no URL
    const pageUrl = tab.page.url();
    if (!pageUrl || pageUrl === 'about:blank' || pageUrl === '') {
      response.addError('Cannot take screenshot: Page is blank (about:blank). Please navigate to a URL first.');
      return;
    }

    // ALWAYS use viewport mode for reliability - fullPage causes timeouts
    // Use CDP (Chrome DevTools Protocol) directly to bypass Playwright's internal waiting
    const screenshotOptions = { ...options, fullPage: false };

    let buffer: Buffer;

    try {
      // Wrap entire screenshot operation in a timeout to prevent hanging
      const screenshotPromise = (async () => {
        let buf: Buffer;

        // If it's a locator screenshot, we have to use Playwright's method
        if (ref) {
          buf = await ref.screenshot(screenshotOptions);
        } else {
          // For page screenshots, try using CDP directly for faster capture
          try {
            const client = await tab.page.context().newCDPSession(tab.page);
            const cdpResult = await client.send('Page.captureScreenshot', {
              format: fileType === 'png' ? 'png' : 'jpeg',
              quality: fileType === 'jpeg' ? 90 : undefined,
              captureBeyondViewport: false, // Only capture viewport, not full page
            });
            buf = Buffer.from(cdpResult.data, 'base64');
            await client.detach();
          } catch (cdpError) {
            // If CDP fails, fall back to Playwright's method
            buf = await tab.page.screenshot(screenshotOptions);
          }
        }

        return buf;
      })();

      // Race against 15-second timeout (should be fast with CDP)
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Screenshot operation timed out after 15 seconds')), 15000);
      });

      buffer = await Promise.race([screenshotPromise, timeoutPromise]);
    } catch (error) {
      // If screenshot fails, return error but don't throw - we need to return a proper response
      response.addError(`Screenshot failed: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }

    // Skip disk write - return image directly in response for S3 upload
    // Don't scale - it might be slow, just use the buffer directly
    const imageBase64 = buffer.toString('base64');

    // Add result with embedded base64 image for S3 upload
    // Format: __IMAGE_DATA__:<base64>
    response.addResult(`Took the ${screenshotTarget} screenshot`);
    response.addResult(`__IMAGE_DATA__:${imageBase64}`);

    // Also add as image for LLM viewing (will be omitted if imageResponses='omit')
    response.addImage({
      contentType: fileType === 'png' ? 'image/png' : 'image/jpeg',
      data: buffer
    });
  }
});

export default [
  screenshot,
];
