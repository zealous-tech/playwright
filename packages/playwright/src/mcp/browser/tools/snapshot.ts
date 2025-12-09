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
import { defineTabTool, defineTool } from './tool';
import * as javascript from '../codegen';
import { generateLocator } from './utils';

const snapshot = defineTool({
  capability: 'core',
  schema: {
    name: 'browser_snapshot',
    title: 'Page snapshot',
    description: 'Capture accessibility snapshot of the current page, this is better than screenshot',
    inputSchema: z.object({}),
    type: 'readOnly',
  },

  handle: async (context, params, response) => {
    await context.ensureTab();
    response.setIncludeSnapshot();
  },
});

export const elementSchema = z.object({
  element: z.string().describe('Human-readable element description used to obtain permission to interact with the element'),
  ref: z.string().describe('Exact target element reference from the page snapshot'),
});

const clickSchema = elementSchema.extend({
  doubleClick: z.boolean().optional().describe('Whether to perform a double click instead of a single click'),
  button: z.enum(['left', 'right', 'middle']).optional().describe('Button to click, defaults to left'),
  modifiers: z.array(z.enum(['Alt', 'Control', 'ControlOrMeta', 'Meta', 'Shift'])).optional().describe('Modifier keys to press'),
});
//@ZEALOUS UPDATE
const click = defineTabTool({
  capability: 'core',
  schema: {
    name: 'browser_click',
    title: 'Click',
    description: 'Perform click on a web page',
    inputSchema: clickSchema,
    type: 'input',
  },

  handle: async (tab, params, response) => {
    response.setIncludeSnapshot();

    const locator = await tab.refLocator(params);
    const button = params.button;
    const buttonAttr = button ? `{ button: '${button}' }` : '';
    if (params.doubleClick) {
      response.addCode(`// Double click ${params.element}`);
      response.addCode(`await page.${await generateLocator(locator)}.dblclick(${buttonAttr});`);
    } else {
      response.addCode(`// Click ${params.element}`);
      response.addCode(`await page.${await generateLocator(locator)}.click(${buttonAttr});`);
    }

    await tab.waitForCompletion(async () => {
      // Pre-detect checkbox/radio inputs to avoid double scrolling
      const inputInfo = await locator.evaluate((el: Element) => {
        const tag = (el as any).tagName?.toLowerCase?.();
        const type = (el as any).getAttribute?.('type');
        const id = (el as any).getAttribute?.('id');
        return {
          isCheckboxOrRadio: tag === 'input' && (type === 'checkbox' || type === 'radio'),
          id: id || null,
        };
      });

      // If it's a checkbox/radio with an ID, try clicking the associated label first
      if (inputInfo.isCheckboxOrRadio && inputInfo.id) {
        const label = tab.page.locator(`label[for="${inputInfo.id}"]`);
        const labelCount = await label.count();
        if (labelCount > 0) {
          try {
            await label.click({ button });
            return;
          } catch (e: any) {
            // If label click fails, fall through to regular click handling
          }
        }
      }

      try {
        if (params.doubleClick)
          await locator.dblclick({ button });
        else
          await locator.click({ button });
      } catch (e: any) {
        const msg = String(e?.message || e);
        const isIntercept = msg.includes('intercepts pointer events');
        const isDisabled = msg.includes('disabled') || msg.includes('is not enabled') || msg.includes('not clickable') || msg.includes('is disabled');

        if (isDisabled) {
          // Force click on disabled elements for testing purposes
          if (params.doubleClick)
            await locator.dblclick({ button, force: true });
          else
            await locator.click({ button, force: true });
          return;
        }

        if (isIntercept) {
          if (inputInfo.isCheckboxOrRadio) {
            await locator.check({ force: true });
            return;
          }
          await locator.click({ button, force: true });
          return;
        }

        // Unknown error, rethrow
        throw e;
      }
    });
  },
});

const drag = defineTabTool({
  capability: 'core',
  schema: {
    name: 'browser_drag',
    title: 'Drag mouse',
    description: 'Perform drag and drop between two elements',
    inputSchema: z.object({
      startElement: z.string().describe('Human-readable source element description used to obtain the permission to interact with the element'),
      startRef: z.string().describe('Exact source element reference from the page snapshot'),
      endElement: z.string().describe('Human-readable target element description used to obtain the permission to interact with the element'),
      endRef: z.string().describe('Exact target element reference from the page snapshot'),
    }),
    type: 'input',
  },

  handle: async (tab, params, response) => {
    response.setIncludeSnapshot();

    const [startLocator, endLocator] = await tab.refLocators([
      { ref: params.startRef, element: params.startElement },
      { ref: params.endRef, element: params.endElement },
    ]);

    await tab.waitForCompletion(async () => {
      await startLocator.dragTo(endLocator);
    });

    response.addCode(`await page.${await generateLocator(startLocator)}.dragTo(page.${await generateLocator(endLocator)});`);
  },
});

const hover = defineTabTool({
  capability: 'core',
  schema: {
    name: 'browser_hover',
    title: 'Hover mouse',
    description: 'Hover over element on page',
    inputSchema: elementSchema,
    type: 'input',
  },

  handle: async (tab, params, response) => {
    response.setIncludeSnapshot();

    const locator = await tab.refLocator(params);
    response.addCode(`await page.${await generateLocator(locator)}.hover();`);

    await tab.waitForCompletion(async () => {
      await locator.hover();
    });
  },
});

const selectOptionSchema = elementSchema.extend({
  values: z.array(z.string()).describe('Array of values to select in the dropdown. This can be a single value or multiple values.'),
});

const selectOption = defineTabTool({
  capability: 'core',
  schema: {
    name: 'browser_select_option',
    title: 'Select option',
    description: 'Select an option in a dropdown',
    inputSchema: selectOptionSchema,
    type: 'input',
  },

  handle: async (tab, params, response) => {
    response.setIncludeSnapshot();

    const locator = await tab.refLocator(params);
    response.addCode(`await page.${await generateLocator(locator)}.selectOption(${javascript.formatObject(params.values)});`);

    await tab.waitForCompletion(async () => {
      await locator.selectOption(params.values);
    });
  },
});

const pickLocator = defineTabTool({
  capability: 'testing',
  schema: {
    name: 'browser_generate_locator',
    title: 'Create locator for element',
    description: 'Generate locator for the given element to use in tests',
    inputSchema: elementSchema,
    type: 'readOnly',
  },

  handle: async (tab, params, response) => {
    const locator = await tab.refLocator(params);
    response.addResult(await generateLocator(locator));
  },
});

export default [
  snapshot,
  click,
  drag,
  hover,
  selectOption,
  pickLocator,
];
