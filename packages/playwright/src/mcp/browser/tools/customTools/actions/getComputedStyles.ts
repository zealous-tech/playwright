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
import { elementStyleSchema } from '../helpers/schemas';

export const get_computed_styles = defineTabTool({
  capability: 'core',
  schema: {
    name: 'get_computed_styles',
    title: 'Get computed styles of element',
    description: 'Get computed styles of element',
    inputSchema: elementStyleSchema,
    type: 'readOnly',
  },
  handle: async (tab, params, response) => {
    // response.setIncludeSnapshot();

    const { ref, element } = elementStyleSchema.parse(params);
    const result = { ref, element };

    const { locator } = await tab.refLocator(result);

    await tab.waitForCompletion(async () => {
      const getStylesFunction = (element: Element, props?: string[]) => {
        const computedStyle = window.getComputedStyle(element);
        const result: { [key: string]: string } = {};
        if (props) {
          props.forEach(propName => {
            result[propName] = computedStyle[propName as any] || computedStyle.getPropertyValue(propName);
          });
        }
        return result;
      };

      response.addCode(`// Get computed styles for ${params.element}`);
      const computedStyles = await locator.evaluate(getStylesFunction, params.propertyNames);
      console.log('Requested Computed Styles : ', computedStyles);
      response.addTextResult(JSON.stringify(computedStyles, null, 2) || 'Couldn\'t get requested styles');
    });
  },
});
