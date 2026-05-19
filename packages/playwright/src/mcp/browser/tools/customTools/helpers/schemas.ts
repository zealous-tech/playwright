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
import { z } from 'playwright-core/lib/mcpBundle';
import { DEFAULT_MAP_SELECTOR, DEFAULT_CONTAINER_SELECTOR } from './helpers';

const elementStyleSchema = z.object({
  element: z.string().describe('Human-readable element description used to obtain permission to interact with the element'),
  ref: z.string().describe('Exact target element reference from the page snapshot'),
  propertyNames: z.array(z.string()).optional().describe('Specific CSS property names to retrieve. If not provided, all computed styles will be returned'),
});

const elementImageSchema = z.object({
  element: z.string().describe('Human-readable element description used to obtain permission to interact with the element'),
  ref: z.string().describe('Exact target element reference from the page snapshot'),
  includeBackgroundImages: z.boolean().optional().default(true).describe('Whether to include CSS background images'),
  includeDataUrls: z.boolean().optional().default(false).describe('Whether to include data URLs (base64 images)'),
  searchDepth: z.enum(['current', 'children', 'all']).optional().default('current').describe('Search scope: current element only, direct children, or all descendants'),
});

const elementSvgSchema = z.object({
  element: z.string().describe('Human-readable element description used to obtain permission to interact with the element'),
  ref: z.string().describe('Exact target element reference from the page snapshot'),
  extractMethod: z.enum(['outerHTML', 'innerHTML', 'serializer']).optional().default('outerHTML').describe('Method to extract SVG: outerHTML (full element), innerHTML (content only), or serializer (XMLSerializer)'),
  includeStyles: z.boolean().optional().default(false).describe('Whether to include computed styles in the extracted SVG'),
  minifyOutput: z.boolean().optional().default(false).describe('Whether to minify the SVG output by removing unnecessary whitespace'),
});

const styleCheckSchema = z.object({
  name: z.string().describe(
      "CSS property name to validate (supports kebab-case or camelCase, e.g. 'color' or 'backgroundColor')"
  ),
  operator: z
      .enum(['isEqual', 'notEqual', 'inRange'])
      .describe(
          "Validation operator: 'isEqual' checks strict equality, 'notEqual' checks strict inequality, 'inRange' checks if value is in list or RGB color is within specified range"
      ),
  expected: z.union([
    z.string(),
    z.array(z.string()),
    z.object({
      minR: z.number().min(0).max(255).describe('Minimum red value (0-255)'),
      maxR: z.number().min(0).max(255).describe('Maximum red value (0-255)'),
      minG: z.number().min(0).max(255).describe('Minimum green value (0-255)'),
      maxG: z.number().min(0).max(255).describe('Maximum green value (0-255)'),
      minB: z.number().min(0).max(255).describe('Minimum blue value (0-255)'),
      maxB: z.number().min(0).max(255).describe('Maximum blue value (0-255)'),
    })
  ]).describe(
      "Expected value(s) for the CSS property. Can be a single string, array of strings for 'inRange' operator, or RGB range object for RGB color validation."
  ),
});

const validateStylesSchema = z.object({
  element: z
      .string()
      .describe(
          'Human-readable element description used to obtain permission to interact with the element'
      ),
  ref: z
      .string()
      .describe('Exact target element reference from the page snapshot'),
  checks: z
      .array(styleCheckSchema)
      .min(1)
      .describe(
          'List of style validation checks to perform on the target element'
      ),
});

const baseDomInputSchema = z.object({
  ref: z.string().min(1),
  element: z.string().min(1).describe('Description of the specific element with the given ref'),
});

// Individual assertion argument schemas
const toBeAttachedArgsSchema = z.object({
  options: z.object({
  }).optional(),
});

const toBeCheckedArgsSchema = z.object({
  options: z.object({
    indeterminate: z.boolean().optional().describe('Asserts that the element is in the indeterminate (mixed) state. Only supported for checkboxes and radio buttons. This option can\'t be true when checked is provided.'),
  }).optional(),
});

const toBeDisabledArgsSchema = z.object({
  options: z.object({
  }).optional(),
});

const toBeEditableArgsSchema = z.object({
  options: z.object({
  }).optional(),
});

const toBeEmptyArgsSchema = z.object({
  options: z.object({
  }).optional(),
});

const toBeEnabledArgsSchema = z.object({
  options: z.object({
  }).optional(),
});

const toBeFocusedArgsSchema = z.object({
  options: z.object({
  }).optional(),
});

const toBeHiddenArgsSchema = z.object({
  options: z.object({
  }).optional(),
});

const toBeInViewportArgsSchema = z.object({
  options: z.object({
    ratio: z.number().optional().describe('The minimal ratio of the element to intersect viewport. If equals to 0, then element should intersect viewport at any positive ratio. Defaults to 0'),
  }).optional(),
});

const toBeVisibleArgsSchema = z.object({
  options: z.object({
  }).optional(),
});

const toContainClassArgsSchema = z.object({
  expected: z.union([z.string(), z.array(z.string())]).describe('A string containing expected class names, separated by spaces, or a list of such strings to assert multiple elements'),
  options: z.object({
  }).optional(),
});

const toContainTextArgsSchema = z.object({
  expected: z.union([z.string(), z.string(), z.array(z.union([z.string(), z.string()]))]).describe('Expected substring or RegExp or a list of those'),
  options: z.object({
    ignoreCase: z.boolean().optional().describe('Whether to perform case-insensitive match. ignoreCase option takes precedence over the corresponding regular expression flag if specified'),
    useInnerText: z.boolean().optional().describe('Whether to use element.innerText instead of element.textContent when retrieving DOM node text'),
  }).optional(),
});

const toHaveAccessibleDescriptionArgsSchema = z.object({
  description: z.union([z.string(), z.string()]).describe('Expected accessible description'),
  options: z.object({
    ignoreCase: z.boolean().optional().describe('Whether to perform case-insensitive match. ignoreCase option takes precedence over the corresponding regular expression flag if specified'),
  }).optional(),
});

const toHaveAccessibleErrorMessageArgsSchema = z.object({
  errorMessage: z.union([z.string(), z.string()]).describe('Expected accessible error message'),
  options: z.object({
    ignoreCase: z.boolean().optional().describe('Whether to perform case-insensitive match. ignoreCase option takes precedence over the corresponding regular expression flag if specified'),
  }).optional(),
});

const toHaveAccessibleNameArgsSchema = z.object({
  name: z.union([z.string(), z.string()]).describe('Expected accessible name'),
  options: z.object({
    ignoreCase: z.boolean().optional().describe('Whether to perform case-insensitive match. ignoreCase option takes precedence over the corresponding regular expression flag if specified'),
  }).optional(),
});

const toHaveAttributeArgsSchema = z.object({
  name: z.string().describe('Attribute name'),
  value: z.union([z.string(), z.string()]).optional().describe('Expected attribute value. If not provided, only checks that attribute exists'),
  options: z.object({
    ignoreCase: z.boolean().optional().describe('Whether to perform case-insensitive match when checking attribute value. Only applicable when "value" is provided. Ignored if "value" is not specified. ignoreCase option takes precedence over the corresponding regular expression flag if specified'),
  }).optional(),
});

const toHaveClassArgsSchema = z.object({
  expected: z.union([z.string(), z.string(), z.array(z.union([z.string(), z.string()]))]).describe('Expected class or RegExp or a list of those'),
  options: z.object({
  }).optional(),
});

const toHaveCountArgsSchema = z.object({
  count: z.number().describe('Expected count'),
  options: z.object({
  }).optional(),
});

const toHaveCSSArgsSchema = z.object({
  name: z.string().describe('CSS property name'),
  value: z.union([z.string(), z.string()]).describe('CSS property value'),
  options: z.object({
  }).optional(),
});

const toHaveIdArgsSchema = z.object({
  id: z.union([z.string(), z.string()]).describe('Element id'),
  options: z.object({
  }).optional(),
});

const toHaveJSPropertyArgsSchema = z.object({
  name: z.string().describe('Property name'),
  value: z.any().describe('Property value'),
  options: z.object({
  }).optional(),
});

const toHaveRoleArgsSchema = z.object({
  role: z.enum(['alert', 'alertdialog', 'application', 'article', 'banner', 'blockquote', 'button', 'caption', 'cell', 'checkbox', 'code', 'columnheader', 'combobox', 'complementary', 'contentinfo', 'definition', 'deletion', 'dialog', 'directory', 'document', 'emphasis', 'feed', 'figure', 'form', 'generic', 'grid', 'gridcell', 'group', 'heading', 'img', 'insertion', 'link', 'list', 'listbox', 'listitem', 'log', 'main', 'marquee', 'math', 'meter', 'menu', 'menubar', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'navigation', 'none', 'note', 'option', 'paragraph', 'presentation', 'progressbar', 'radio', 'radiogroup', 'region', 'row', 'rowgroup', 'rowheader', 'scrollbar', 'search', 'searchbox', 'separator', 'slider', 'spinbutton', 'status', 'strong', 'subscript', 'superscript', 'switch', 'tab', 'table', 'tablist', 'tabpanel', 'term', 'textbox', 'time', 'timer', 'toolbar', 'tooltip', 'tree', 'treegrid', 'treeitem']).describe('Required aria role'),
  options: z.object({
  }).optional(),
});

const toHaveScreenshotArgsSchema = z.object({
  name: z.union([z.string(), z.array(z.string())]).optional().describe('Snapshot name. If not provided, screenshot will be compared without a name (using options only)'),
  options: z.object({
    animations: z.enum(['disabled', 'allow']).optional().describe('When set to "disabled", stops CSS animations, CSS transitions and Web Animations'),
    caret: z.enum(['hide', 'initial']).optional().describe('When set to "hide", screenshot will hide text caret'),
    mask: z.array(z.any()).optional().describe('Specify locators that should be masked when the screenshot is taken'),
    maskColor: z.string().optional().describe('Specify the color of the overlay box for masked elements, in CSS color format'),
    maxDiffPixelRatio: z.number().min(0).max(1).optional().describe('An acceptable ratio of pixels that are different to the total amount of pixels, between 0 and 1'),
    maxDiffPixels: z.number().optional().describe('An acceptable amount of pixels that could be different'),
    omitBackground: z.boolean().optional().describe('Hides default white background and allows capturing screenshots with transparency'),
    scale: z.enum(['css', 'device']).optional().describe('When set to "css", screenshot will have a single pixel per each css pixel on the page'),
    stylePath: z.union([z.string(), z.array(z.string())]).optional().describe('File name containing the stylesheet to apply while making the screenshot'),
    threshold: z.number().min(0).max(1).optional().describe('An acceptable perceived color difference in the YIQ color space between the same pixel in compared images, between zero (strict) and one (lax)'),
  }).optional(),
});


const toHaveTextArgsSchema = z.object({
  expected: z.union([z.string(), z.string(), z.array(z.union([z.string(), z.string()]))]).describe('Expected string or RegExp or a list of those'),
  options: z.object({
    ignoreCase: z.boolean().optional().describe('Whether to perform case-insensitive match. ignoreCase option takes precedence over the corresponding regular expression flag if specified'),
    useInnerText: z.boolean().optional().describe('Whether to use element.innerText instead of element.textContent when retrieving DOM node text'),
  }).optional(),
});


const toHaveValueArgsSchema = z.object({
  value: z.union([z.string(), z.string()]).describe('Expected value'),
  options: z.object({
  }).optional(),
});

const toHaveValuesArgsSchema = z.object({
  values: z.array(z.union([z.string(), z.string()])).describe('Expected options currently selected'),
  options: z.object({
  }).optional(),
});

const selectHasValueArgsSchema = z.object({
  value: z.string().describe('Expected value (case and space insensitive)'),
  contains: z.boolean().optional().default(false).describe('When true, checks if the select value contains the expected string instead of exact match'),
  options: z.object({
  }).optional(),
});

const toMatchAriaSnapshotArgsSchema = z.object({
  expected: z.string().describe('Expected accessibility snapshot'),
  options: z.object({
  }).optional(),
});

const toMatchAriaSnapshotOptionsArgsSchema = z.object({
  options: z.object({
    name: z.string().optional().describe('Name of the snapshot to store in the snapshot folder corresponding to this test. Generates sequential names if not specified'),
  }).optional(),
});

const checkAlertInSnapshotSchema = z.object({
  element: z.string().describe('Human-readable element description for logging purposes'),
  matchType: z.enum(['contains', 'not-contains']).default('contains').describe(
      "Type of match: 'contains' checks if alert dialog is present, 'not-contains' checks that alert dialog is NOT present"
  ),
  hasText: z.string().optional().describe(
      'Optional text to check if it exists in the alert dialog message. If provided and alert exists, will verify if this text is present in the alert message'
  ),
});

const defaultValidationSchema = z.object({
  ref: z.string().optional().describe('Element reference from the page snapshot. Required for element-based validation, omit for data-only validation.'),
  element: z.string().optional().describe('Description of the specific element with the given ref. Required for element-based validation, omit for data-only validation.'),
  jsCode: z.string().describe('JavaScript code to execute. Element mode (ref+element provided): receives "element" (DOM node) and "document". Data-only mode (no ref/element): receives only "document", works with inline data from variable replacement. Must return "pass"/"fail" string OR rich object { result: "pass"|"fail", message: "Human readable description", expected: value, actual: value }.'),
});

const validateResponseSchema = z.object({
  responseData: z.string().describe('Response data as JSON string'),
  checks: z.array(z.object({
    name: z.string().describe('Name/description of the check for logging purposes'),
    jsonPath: z.string().describe('JSONPath expression. Examples: $.store.book[0].title (specific element), $..author (recursive descent), $.store.book[*].author (wildcard), $.store.book[?(@.price<10)] (filter), $.store.book[(@.length-1)] (script). Use $ as root, dot notation or brackets for properties. If the path ends with .length and if the value at the path is an array, the validated value will be that array\'s length.'),
    expected: z.any().optional().describe('Expected value for comparison'),
    operator: z.enum(['equals', 'not_equals', 'greater_than', 'less_than', 'hasValue', 'every_in', 'some_in']).optional().default('equals').describe('Comparison operator. hasValue checks if value exists at jsonPath (expected should be true/false)')
  })).min(1).describe('Array of validation checks to perform'),
});

const validateExpandedSchema = z.object({
  element: z.string().describe('Human-readable element description used to obtain permission to interact with the element'),
  ref: z.string().describe('Exact target element reference from the page snapshot'),
  expected: z.union([z.literal('true'), z.literal('false')]).describe('Expected value for aria-expanded attribute: "true" or "false"'),
});

const validateTextInWholePageSchema = z.object({
  element: z.string().describe(
      'Human-readable element description used to obtain permission to interact with the element'
  ),
  expectedText: z.string().describe(
      'Expected text value(s) to validate. Can be a single string or a JSON-stringified array of strings (e.g. "[\"foo\", \"bar\"]") — array values are combined with OR into a case-insensitive RegExp.'
  ),
  matchType: z.enum(['exact', 'contains', 'not-contains']).default('exact').describe(
      "Type of match: 'exact' checks exact match, 'contains' checks substring presence, 'not-contains' checks that text is NOT present."
  ),
});

const validateElementInWholePageSchema = z.object({
  element: z.string().describe(
      'Human-readable element description used to obtain permission to interact with the element'
  ),
  role: z.string().describe(
      'ARIA role of the element to search for'
  ),
  accessibleName: z.string().describe(
      'Accessible name of the element to search for'
  ),
  locator: z.string().optional().describe(
      'Optional Playwright locator string. If provided, role and accessibleName are ignored. This locator will be treated as WEAK evidence.'
  ),
  matchType: z.enum(['exist', 'not-exist']).default('exist').describe(
      "Type of match: 'exist' checks that the element exists at least once (main page or any iframe); 'not-exist' checks that it does not appear in any frame"
  ),
});

const validateElementVisibilitySchema = z.object({
  element: z.string().describe(
      'Human-readable element description used to obtain permission to interact with the element'
  ),
  locator: z.string().describe(
      'Playwright locator expression — must start with "getBy" or "locator(". Prefer semantic "getBy" locators: getByRole(\'button\', { name: \'Submit\' }), getByText(\'Hello\'), getByLabel(\'Email\'). Fall back to locator() with a CSS selector only when no suitable getBy exists: locator(\'#my-id\'), locator(\'.my-class\').'
  ),
  visibility: z.enum(['visible', 'not-visible']).default('visible').describe(
      "Visibility check: 'visible' checks that the element is visible at least once (main page or any iframe); 'not-visible' checks that it does not appear in any frame"
  ),
});

const dataExtractionSchema = z.object({
  name: z.string().describe('Variable name (will be prefixed with $$)'),
  data: z.string().describe('Data to extract from. If jsonPath is provided, should be JSON string. If jsonPath is not provided, can be any string data'),
  jsonPath: z.string().optional().describe('JSONPath expression. Examples: $.store.book[0].title (specific element), $..author (recursive descent), $.store.book[*].author (wildcard), $.store.book[?(@.price<10)] (filter), $.store.book[(@.length-1)] (script). Use $ as root, dot notation or brackets for properties. If the path ends with .length and if the value at the path is an array, the extracted value will be that array\'s length.'),
});

const waitSchema = z.object({
  seconds: z.number().positive().describe('Duration to wait in seconds'),
});

const validateElementPositionSchema = z.object({
  elements: z.array(z.object({
    element: z.string().describe('Human-readable description of the element used to obtain permission to interact with the element'),
    ref: z.string().describe('Exact target element reference from the page snapshot'),
  })).min(2).max(2).describe('Array of exactly two elements to compare position. First element is element1, second is element2'),
  relationship: z.enum(['left', 'right', 'up', 'down']).describe('Expected positional relationship: "left" means elements[0] is to the left of elements[1], "right" means elements[0] is to the right of elements[1], "up" means elements[0] is above elements[1], "down" means elements[0] is below elements[1]'),
});

const validateElementOrderSchema = z.object({
  elements: z.array(z.object({
    element: z.string().describe('Human-readable description of the element used to obtain permission to interact with the element'),
    ref: z.string().describe('Exact target element reference from the page snapshot for the element'),
  })).min(2).describe('Array of elements to validate order for (minimum 2 elements required). Elements should be provided in the expected visual order.'),
});

// Dynamic switch tool: choose a tool based on flag value
const dynamicSwitchSchema = z.object({
  flagName: z.string().describe('Flag value to match against cases (agent will replace this with actual value)'),
  cases: z.array(z.object({
    equals: z.string().describe('Exact string value to match against flag value'),
    toolName: z.string().describe('Tool name to invoke when matched'),
    params: z.any().optional().describe('Parameters to pass to the selected tool'),
    readyForCaching: z.boolean().optional().default(false).describe('Set to true if all tools and parameters are successfully obtained for this specific case - the model clearly knows which parameters to use for this case and tool. Set to false if this case is missing required information for parameters, e.g. an action needs a ref that is not available in the snapshot')
  })).min(1).describe('Ordered switch-cases; first matching case wins'),
  defaultCase: z.object({
    toolName: z.string(),
    params: z.any().optional(),
    readyForCaching: z.boolean().optional().default(false).describe('Set to true if all tools and parameters are successfully obtained for this default case - the model clearly knows which parameters to use for this case and tool. Set to false if this case is missing required information for parameters, e.g. an action needs a ref that is not available in the snapshot')
  }).optional().describe('Fallback if no case matches. If it is not specified what needs to be done for defaultCase, then it should be left empty (not provided)'),
});

const makeRequestSchema = z.object({
  command: z.string().describe('Actual finalized command'),
  evidence: z.string().describe('Command description'),
});

const validateTabExistSchema = z.object({
  url: z.string().describe('URL or regex to check for in existing browser tabs'),
  title: z.string().optional().describe('Page title or regex to validate'),
  matchType: z.enum(['exist', 'not-exist']).describe('Whether to check if tab exists or does not exist'),
  exactMatch: z.boolean().optional().default(true).describe('Whether to require exact URL match (true) or partial match (false). Ignored when regex is used'),
  isCurrent: z.boolean().optional().describe('If true, also validates that the found tab is the current active tab'),
});

const validateTabCountSchema = z.object({
  expectedCount: z.number().int().min(0).describe('Expected number of open browser tabs'),
  operator: z.enum(['equals', 'notEquals']).optional().default('equals').describe('Comparison operator to use when comparing actual tab count against expected count'),
});

const generateLocatorSchema = z.object({
  ref: z.string().describe('Element reference from page snapshot'),
  element: z.string().describe('Human-readable element description for logging'),
  preferCssSelector: z.boolean().optional().describe('When true, prefer CSS/id-based selectors over Playwright semantic locators for getByText elements'),
});

const customWaitSchema = z.object({
  time: z.number().optional().describe('Maximum time to wait in seconds for text to appear/disappear. If not provided, default actionTimeout is used'),
  text: z.string().optional().describe('The text to wait for'),
  textGone: z.string().optional().describe('The text to wait for to disappear'),
});

const ottoClickSchema = z.object({
  element: z.string().optional().describe('Human-readable element description used to obtain permission to interact with the element'),
  ref: z.string().describe('Exact target element reference from the page snapshot'),
  doubleClick: z.boolean().optional().describe('Whether to perform a double click instead of a single click'),
  button: z.enum(['left', 'right', 'middle']).optional().describe('Button to click, defaults to left'),
  modifiers: z.array(z.enum(['Alt', 'Control', 'ControlOrMeta', 'Meta', 'Shift'])).optional().describe('Modifier keys to press'),
});

// Union schema for all assertion arguments
const assertionArgumentsSchema = z.discriminatedUnion('assertionType', [
  z.object({ assertionType: z.literal('toBeAttached'), ...toBeAttachedArgsSchema.shape }),
  z.object({ assertionType: z.literal('toBeChecked'), ...toBeCheckedArgsSchema.shape }),
  z.object({ assertionType: z.literal('toBeDisabled'), ...toBeDisabledArgsSchema.shape }),
  z.object({ assertionType: z.literal('toBeEditable'), ...toBeEditableArgsSchema.shape }),
  z.object({ assertionType: z.literal('toBeEmpty'), ...toBeEmptyArgsSchema.shape }),
  z.object({ assertionType: z.literal('toBeEnabled'), ...toBeEnabledArgsSchema.shape }),
  z.object({ assertionType: z.literal('toBeFocused'), ...toBeFocusedArgsSchema.shape }),
  z.object({ assertionType: z.literal('toBeHidden'), ...toBeHiddenArgsSchema.shape }),
  z.object({ assertionType: z.literal('toBeInViewport'), ...toBeInViewportArgsSchema.shape }),
  z.object({ assertionType: z.literal('toBeVisible'), ...toBeVisibleArgsSchema.shape }),
  z.object({ assertionType: z.literal('toContainClass'), ...toContainClassArgsSchema.shape }),
  z.object({ assertionType: z.literal('toContainText'), ...toContainTextArgsSchema.shape }),
  z.object({ assertionType: z.literal('toHaveAccessibleDescription'), ...toHaveAccessibleDescriptionArgsSchema.shape }),
  z.object({ assertionType: z.literal('toHaveAccessibleErrorMessage'), ...toHaveAccessibleErrorMessageArgsSchema.shape }),
  z.object({ assertionType: z.literal('toHaveAccessibleName'), ...toHaveAccessibleNameArgsSchema.shape }),
  z.object({ assertionType: z.literal('toHaveAttribute'), ...toHaveAttributeArgsSchema.shape }),
  z.object({ assertionType: z.literal('toHaveClass'), ...toHaveClassArgsSchema.shape }),
  z.object({ assertionType: z.literal('toHaveCount'), ...toHaveCountArgsSchema.shape }),
  z.object({ assertionType: z.literal('toHaveCSS'), ...toHaveCSSArgsSchema.shape }),
  z.object({ assertionType: z.literal('toHaveId'), ...toHaveIdArgsSchema.shape }),
  z.object({ assertionType: z.literal('toHaveJSProperty'), ...toHaveJSPropertyArgsSchema.shape }),
  z.object({ assertionType: z.literal('toHaveRole'), ...toHaveRoleArgsSchema.shape }),
  z.object({ assertionType: z.literal('toHaveScreenshot'), ...toHaveScreenshotArgsSchema.shape }),
  z.object({ assertionType: z.literal('toHaveText'), ...toHaveTextArgsSchema.shape }),
  z.object({ assertionType: z.literal('toHaveValue'), ...toHaveValueArgsSchema.shape }),
  z.object({ assertionType: z.literal('toHaveValues'), ...toHaveValuesArgsSchema.shape }),
  z.object({ assertionType: z.literal('selectHasValue'), ...selectHasValueArgsSchema.shape }),
  z.object({ assertionType: z.literal('toMatchAriaSnapshot'), ...toMatchAriaSnapshotArgsSchema.shape }),
  z.object({ assertionType: z.literal('toMatchAriaSnapshotOptions'), ...toMatchAriaSnapshotOptionsArgsSchema.shape }),
]);

// Schema for DOM assertions using Playwright expect assertions
const domAssertionCheckSchema = z.object({
  negate: z.boolean().optional().default(false).describe('Whether to negate the assertion (use .not)'),
  assertion: assertionArgumentsSchema.describe('Assertion type and its specific arguments'),
});

const domAssertionChecksSchema = z.array(domAssertionCheckSchema).min(1);

const validateDomAssertionsSchema = baseDomInputSchema.extend({
  checks: domAssertionChecksSchema,
});

const mapSelectorField = z
  .string()
  .default(DEFAULT_MAP_SELECTOR)
  .describe(
    `CSS selector used to locate the map element and wait for it to appear before interacting. Use the default value unless a custom one is specified.`,
  );

const containerSelectorField = z
  .string()
  .default(DEFAULT_CONTAINER_SELECTOR)
  .describe(
    `CSS selector for the seatmap container element used to resolve the map JS object. Use the default value unless a custom one is specified.`,
  );

const sectionTagEnum = z.enum([
  'filteredsection',
  'selected',
  'none',
]);

const sectionStateEnum = z.enum([
  'available',
  'unavailable',
]);

const sectionSchema = z.object({
  element: z.string().describe(
    'Human-readable description of the specific section being interacted with (e.g. "section 111 on the map")'
  ),
  mapSelector: mapSelectorField,
  containerSelector: containerSelectorField,
  section: z
    .string()
    .optional()
    .describe(
      'Section identifier (e.g. "111", "ADAGA"). When omitted, a random available section is chosen automatically.',
    ),
  sectionType: z
    .enum(['section', 'general_admission'])
    .default('section')
    .describe(
      'Node type to operate on: "section" for regular numbered sections, "general_admission" for GA sections. Defaults to "section".',
    ),
  tag: sectionTagEnum
    .optional()
    .describe(
      'Filter available sections by tag. Applied only when "section" is omitted (random-selection mode). Defaults to "none".',
    ),
});

const seatTagEnum = z.enum([
  'standard',
  'flashseats',
  'premium',
  'premiumvip',
  'accessible',
  'demandtickets',
  'filteredstandard',
  'filteredflashseats',
  'Hold-Standard',
  'Sold-Standard',
  'Open-Standard',
  'filtered',
]);

const seatStateEnum = z.enum([
  'available',
  'unavailable',
  'selected',
]);

const seatSchema = z.object({
  element: z.string().describe(
    'Human-readable description of the specific seat being interacted with (e.g. "seat 19 row 2 section 112 on the map")'
  ),
  mapSelector: mapSelectorField,
  containerSelector: containerSelectorField,
  section: z
    .string()
    .optional()
    .describe('Section identifier (e.g. "112").'),
  row: z
    .string()
    .optional()
    .describe('Row identifier within the section (e.g. "8").'),
  seat: z
    .string()
    .optional()
    .describe('Seat number within the row (e.g. "14").'),
  tag: z.enum([...seatTagEnum.options, 'non-filtered'])
    .optional()
    .describe(
      'Filter available seats by tag/type. Applied in all random-selection modes (when seat is not fully specified). Ignored when section+row+seat are all supplied.',
    ),
  state: seatStateEnum
    .optional()
    .describe(
      'Filter seats by state. Applied in all random-selection modes (when seat is not fully specified). Defaults to "available".',
    ),
});

const fileDownloadSchema = z.object({
  fileName: z.string().describe(
    'Logical name for the downloaded file. This name is used to reference the file data later as ${<fileName>} in validations or actions.'
  ),
  hubUploadUrl: z.string().optional().describe(
    'URL to upload the downloaded file to the command hub. Automatically injected by the hub — do not set manually.'
  ),
  waitForDownload: z.boolean().optional().default(false).describe(
    'When true, waits up to `timeout` seconds for a new download to appear (use when the export button was clicked in a prior action). When false, reads the most recent already-completed download.'
  ),
  timeout: z.number().optional().default(30).describe(
    'Maximum seconds to wait for the download to complete (only used when waitForDownload is true).'
  ),
});

const validateMapNodeSchema = z.object({
  element: z.string().describe(
    'Human-readable description of the node being validated (e.g. "seat 5 row 2 section 112" or "section 110")'
  ),
  mapSelector: mapSelectorField,
  containerSelector: containerSelectorField,
  nodeType: z.enum(['seat', 'section', 'general_admission']).describe(
    'Type of map node to validate: "seat" for individual seats, "section" for section nodes, "general_admission" for GA sections.'
  ),
  targets: z.array(z.object({
    section: z.string().optional().describe('Section identifier (e.g. "112")'),
    row:     z.string().optional().describe('Row identifier (e.g. "2"). Only relevant for seat nodes.'),
    seat:    z.string().optional().describe('Seat number within the row (e.g. "5"). Only relevant for seat nodes.'),
  })).optional().describe(
    'List of nodes to validate. Each entry identifies a seat (section+row+seat) or section/GA node (section). ' +
    'All entries share the same nodeType, expectedStyles and expectedStates. ' +
    'For general_admission nodes, omit targets entirely — nodeType "general_admission" is sufficient.'
  ),
  expectedStyles: z.object({
    fillStyle: z.object({
      from:   z.string().describe('Lower bound hex color, e.g. "#0070EE"'),
      to:     z.string().describe('Upper bound hex color, e.g. "#0090FF"'),
      negate: z.boolean().optional().describe('If true, asserts the color is outside the range'),
    }).optional().describe('Expected fillStyle hex color range. Each RGB channel of the actual color must fall between from and to.'),
    textFillStyle: z.object({
      from:   z.string().describe('Lower bound hex color, e.g. "#F0F0F0"'),
      to:     z.string().describe('Upper bound hex color, e.g. "#FFFFFF"'),
      negate: z.boolean().optional().describe('If true, asserts the color is outside the range'),
    }).optional().describe('Expected textFillStyle hex color range. Each RGB channel of the actual color must fall between from and to.'),
    iconTag: z.object({
      value:  z.string().describe('Seat tag whose icon should be validated (e.g. "premium", "accessible", "flashseats")'),
      negate: z.boolean().optional().describe('If true, asserts the icon does NOT match the resolved value'),
    }).optional().describe(
      'Validates actualStyle.icon against the icon resolved from the given tag via the internal tag→icon mapping. ' +
      'Applicable to seat nodes only.'
    ),
  }).optional().describe(
    'Style properties to validate against the resolved style config. ' +
    'Supports "fillStyle", "textFillStyle" (all node types) and "iconTag" (seat nodes only). ' +
    'If omitted the tool returns the actual style info without a pass/fail result.'
  ),
  expectedStates: z.object({
    tag: z.object({
      value: z.union([
        sectionTagEnum.describe('Use for section or general_admission nodes'),
        seatTagEnum.describe('Use for seat nodes'),
      ]),
      negate: z.boolean().optional().describe('If true, asserts the tag does NOT match the value'),
    }).optional(),
    hover: z.object({
      value: z.boolean().describe('true = hovered, false = not hovered'),
    }).optional(),
    state: z.object({
      value: z.union([
        sectionStateEnum.describe('Use for section or general_admission nodes'),
        seatStateEnum.describe('Use for seat nodes'),
      ]),
      negate: z.boolean().optional().describe('If true, asserts the state does NOT match the value'),
    }).optional(),
    description: z.object({
      value: z.string().describe('Expected description string of the seat/section'),
      negate: z.boolean().optional().describe('If true, asserts the description does NOT match the value'),
    }).optional(),
  }).optional().describe(
    'Node state properties to validate. Supported keys: "tag", "hover", "state", "description". ' +
    'Each key is compared against the actual runtime value of the corresponding node property.'
  ),
})

export {
  fileDownloadSchema,
  elementStyleSchema,
  elementImageSchema,
  elementSvgSchema,
  validateStylesSchema,
  validateDomAssertionsSchema,
  checkAlertInSnapshotSchema,
  defaultValidationSchema,
  validateResponseSchema,
  validateExpandedSchema,
  validateTextInWholePageSchema,
  validateElementInWholePageSchema,
  validateElementVisibilitySchema,
  dataExtractionSchema,
  waitSchema,
  validateElementPositionSchema,
  validateElementOrderSchema,
  dynamicSwitchSchema,
  makeRequestSchema,
  validateTabExistSchema,
  validateTabCountSchema,
  generateLocatorSchema,
  customWaitSchema,
  ottoClickSchema,
  sectionSchema,
  seatSchema,
  validateMapNodeSchema,
};
