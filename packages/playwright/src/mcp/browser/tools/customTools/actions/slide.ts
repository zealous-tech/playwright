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

import { defineTabTool } from '../../tool';
import { slideSchema } from '../helpers/schemas';
import { calculateTargetValue, isInputElement, setAriaValue } from '../helpers/utils';

export const slide = defineTabTool({
  capability: 'core',
  schema: {
    name: 'browser_slide',
    title: 'Slide',
    description: 'Slide to specified value',
    inputSchema: slideSchema,
    type: 'input',
  },

  handle: async (tab, params, response) => {
    response.setIncludeSnapshot();

    const { locator, resolved } = await tab.refLocator(params);
    const targetValueStr = await locator.evaluate(calculateTargetValue, params);

    const isInput = await locator.evaluate(isInputElement);

    if (isInput) {
      response.addCode(`await page.${resolved}.fill('${targetValueStr}');`);
      await tab.waitForCompletion(async () => {
        await locator.waitFor({ state: 'visible' });
        await locator.fill(targetValueStr);
      });
    } else {
      response.addCode(`await page.${resolved}.evaluate(${setAriaValue.toString()}, '${targetValueStr}');`);
      await tab.waitForCompletion(async () => {
        await locator.waitFor({ state: 'visible' });
        await locator.evaluate(setAriaValue, targetValueStr);
      });
    }

    await tab.page.waitForLoadState('load');
  },
});
