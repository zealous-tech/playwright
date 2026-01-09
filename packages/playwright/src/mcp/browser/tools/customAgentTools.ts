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
import { z } from 'zod';
//@ZEALOUS UPDATE
import * as jp from 'jsonpath';
import { defineTabTool, defineTool } from './tool.js';
import { getAllComputedStylesDirect, pickActualValue, parseRGBColor, isColorInRange,runCommandClean, compareValues, checkElementVisibilityUnique, checkTextVisibilityInAllFrames, getElementErrorMessage, generateLocatorString, getAssertionMessage, getAssertionEvidence, getXPathCode, collectAllFrames } from './helperFunctions.js';
import { generateLocator } from './utils.js';
import { expect } from '@zealous-tech/playwright/test';
import { asLocator } from 'playwright-core/lib/utils';
import type * as playwright from '@zealous-tech/playwright';

// Global timeout for element attachment validation (in milliseconds)
const ELEMENT_ATTACHED_TIMEOUT = 15000;

// Helper function to convert string to RegExp if it looks like a regex
function stringToRegExp(str: string): string | RegExp {
  // Check if string looks like a regex pattern (starts and ends with /)
  if (str.startsWith('/') && str.endsWith('/') && str.length > 2) {
    const pattern = str.slice(1, -1); // Remove leading and trailing /
    try {
      return new RegExp(pattern);
    } catch (e) {
      // If RegExp creation fails, return original string
      return str;
    }
  }
  return str;
}

// Helper function to convert string values to RegExp in objects
function convertStringToRegExp(obj: any): any {
  if (typeof obj === 'string') {
    return stringToRegExp(obj);
  }

  if (Array.isArray(obj)) {
    return obj.map(convertStringToRegExp);
  }

  if (obj && typeof obj === 'object') {
    const converted: any = {};
    for (const [key, value] of Object.entries(obj)) {
      // Convert specific fields that can contain RegExp values
      if (key === 'expected' || key === 'value' || key === 'values' ||
          key === 'name' || key === 'description' || key === 'errorMessage' ||
          key === 'id' || key === 'role') {
        converted[key] = convertStringToRegExp(value);
      } else {
        converted[key] = value;
      }
    }
    return converted;
  }

  return obj;
}

// Helper function to normalize value by removing spaces and converting to lowercase
function normalizeValue(value: string): string {
  return value.replace(/\s+/g, '').toLowerCase();
}

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

const get_computed_styles = defineTabTool({
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

    const locator = await tab.refLocator(result);

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
      response.addResult(JSON.stringify(computedStyles, null, 2) || 'Couldn\'t get requested styles');
    });
  },
});

const extract_svg_from_element = defineTabTool({
  capability: 'core',
  schema: {
    name: 'extract_svg_from_element',
    title: 'Extract SVG from Element',
    description: 'Extracts SVG content from a specified element on the page',
    inputSchema: elementSvgSchema,
    type: 'readOnly',
  },
  handle: async (tab, params, response) => {
    // response.setIncludeSnapshot();

    const { ref, element, extractMethod, includeStyles, minifyOutput } = elementSvgSchema.parse(params);
    const result = { ref, element };

    const locator = await tab.refLocator(result);

    await tab.waitForCompletion(async () => {
      try {
        const extractSvgFunction = (element: Element, options: {
          extractMethod: string;
          includeStyles: boolean;
          minifyOutput: boolean;
        }) => {
          // Check if element is SVG or contains SVG
          let svgElement: SVGElement | null = null;

          if (element.tagName.toLowerCase() === 'svg') {
            svgElement = element as SVGElement;
          } else {
            // Look for SVG child elements
            svgElement = element.querySelector('svg');
          }

          if (!svgElement)
            throw new Error('No SVG element found in the specified element');


          let extractedContent = '';

          // Extract based on method
          switch (options.extractMethod) {
            case 'innerHTML':
              extractedContent = `<svg${Array.from(svgElement.attributes).map(attr => ` ${attr.name}="${attr.value}"`).join('')}>${svgElement.innerHTML}</svg>`;
              break;
            case 'serializer':
              const serializer = new XMLSerializer();
              extractedContent = serializer.serializeToString(svgElement);
              break;
            case 'outerHTML':
            default:
              extractedContent = svgElement.outerHTML;
              break;
          }

          // Include computed styles if requested
          if (options.includeStyles) {
            const computedStyle = window.getComputedStyle(svgElement);
            const styleString = Array.from(computedStyle).map(prop =>
              `${prop}: ${computedStyle.getPropertyValue(prop)}`
            ).join('; ');

            // Add style attribute to the SVG
            extractedContent = extractedContent.replace('<svg', `<svg style="${styleString}"`);
          }

          // Minify if requested
          if (options.minifyOutput)
            extractedContent = extractedContent.replace(/\s+/g, ' ').trim();

          //console.dir(extractedContent, { depth: null });
          return {
            svgContent: extractedContent,
            elementInfo: {
              tagName: svgElement.tagName,
              width: svgElement.getAttribute('width') || svgElement.getBoundingClientRect().width,
              height: svgElement.getAttribute('height') || svgElement.getBoundingClientRect().height,
              viewBox: svgElement.getAttribute('viewBox'),
              classList: Array.from(svgElement.classList),
              id: svgElement.id,
            }
          };
        };

        response.addCode(`// Extract SVG content from ${params.element}`);
        const svgContent = await locator.evaluate(extractSvgFunction, { extractMethod, includeStyles, minifyOutput });
        response.addResult(svgContent.svgContent);

      } catch (error) {
        response.addCode(`// Failed to extract SVG from ${params.element}`);
        const errorMessage = `Failed to extract SVG from ${element}. Error: ${error instanceof Error ? error.message : String(error)}`;
        response.addResult(errorMessage);
      }
    });
  },
});


const extract_image_urls = defineTabTool({
  capability: 'core',
  schema: {
    name: 'extract_image_urls',
    title: 'Extract Image URLs from Element',
    description: 'Extracts all image URLs from a specified element including img src, background images, and other image sources',
    inputSchema: elementImageSchema,
    type: 'readOnly',
  },
  handle: async (tab, params, response) => {
    // response.setIncludeSnapshot();

    const { ref, element, includeBackgroundImages, includeDataUrls, searchDepth } = elementImageSchema.parse(params);
    const result = { ref, element };

    let locator: playwright.Locator | undefined;
    locator = await tab.refLocator(result);

    await tab.waitForCompletion(async () => {
      try {
        const extractImageFunction = (element: Element, options: {
          includeBackgroundImages: boolean;
          includeDataUrls: boolean;
          searchDepth: string;
        }) => {
          const imageUrls: {
            url: string;
            type: 'img' | 'background' | 'srcset' | 'picture' | 'svg' | 'other';
            element: string;
            alt?: string;
            title?: string;
          }[] = [];

          // Helper function to check if URL should be included
          const shouldIncludeUrl = (url: string): boolean => {
            if (!url || url.trim() === '')
              return false;
            if (!options.includeDataUrls && url.startsWith('data:'))
              return false;
            return true;
          };

          // Helper function to get element selector
          const getElementSelector = (el: Element): string => {
            if (el.id)
              return `#${el.id}`;
            if (el.className)
              return `.${Array.from(el.classList).join('.')}`;
            return el.tagName.toLowerCase();
          };

          // Helper function to extract images from a single element
          const extractFromElement = (el: Element) => {
            // 1. IMG elements
            if (el.tagName === 'IMG') {
              const imgEl = el as HTMLImageElement;
              if (shouldIncludeUrl(imgEl.src)) {
                imageUrls.push({
                  url: imgEl.src,
                  type: 'img',
                  element: getElementSelector(el),
                  alt: imgEl.alt || undefined,
                  title: imgEl.title || undefined,
                });
              }

              // Handle srcset attribute
              if (imgEl.srcset) {
                const srcsetUrls = imgEl.srcset.split(',').map(src => src.trim().split(' ')[0]);
                srcsetUrls.forEach(url => {
                  if (shouldIncludeUrl(url)) {
                    imageUrls.push({
                      url: url,
                      type: 'srcset',
                      element: getElementSelector(el),
                      alt: imgEl.alt || undefined,
                    });
                  }
                });
              }
            }

            // 2. Background images from CSS
            if (options.includeBackgroundImages) {
              const computedStyle = window.getComputedStyle(el);
              const backgroundImage = computedStyle.backgroundImage;

              if (backgroundImage && backgroundImage !== 'none') {
                // Extract URLs from background-image (can have multiple)
                const urlMatches = backgroundImage.match(/url\(['"]?([^'"]*?)['"]?\)/g);
                if (urlMatches) {
                  urlMatches.forEach(match => {
                    const url = match.replace(/url\(['"]?([^'"]*?)['"]?\)/, '$1');
                    if (shouldIncludeUrl(url)) {
                      imageUrls.push({
                        url: url,
                        type: 'background',
                        element: getElementSelector(el),
                      });
                    }
                  });
                }
              }
            }

            // 3. Picture elements
            if (el.tagName === 'PICTURE') {
              const sources = el.querySelectorAll('source');
              sources.forEach(source => {
                if (source.srcset) {
                  const srcsetUrls = source.srcset.split(',').map(src => src.trim().split(' ')[0]);
                  srcsetUrls.forEach(url => {
                    if (shouldIncludeUrl(url)) {
                      imageUrls.push({
                        url: url,
                        type: 'picture',
                        element: getElementSelector(el),
                      });
                    }
                  });
                }
              });
            }

            // 4. SVG elements with image elements inside
            if (el.tagName === 'SVG') {
              const imageElements = el.querySelectorAll('image');
              imageElements.forEach(img => {
                const href = img.getAttribute('href') || img.getAttribute('xlink:href');
                if (href && shouldIncludeUrl(href)) {
                  imageUrls.push({
                    url: href,
                    type: 'svg',
                    element: getElementSelector(el),
                  });
                }
              });
            }

            // 5. Other elements with image-related attributes
            ['data-src', 'data-original', 'data-lazy-src', 'poster'].forEach(attr => {
              const value = el.getAttribute(attr);
              if (value && shouldIncludeUrl(value)) {
                imageUrls.push({
                  url: value,
                  type: 'other',
                  element: getElementSelector(el),
                });
              }
            });
          };

          // Extract based on search depth
          switch (options.searchDepth) {
            case 'current':
              extractFromElement(element);
              break;
            case 'children':
              extractFromElement(element);
              Array.from(element.children).forEach(extractFromElement);
              break;
            case 'all':
              extractFromElement(element);
              const allElements = element.querySelectorAll('*');
              Array.from(allElements).forEach(extractFromElement);
              break;
          }

          // Remove duplicates
          const uniqueImages = imageUrls.filter((img, index, self) =>
            index === self.findIndex(i => i.url === img.url && i.type === img.type)
          );

          return {
            totalFound: uniqueImages.length,
            images: uniqueImages,
            searchDepth: options.searchDepth,
            includeBackgroundImages: options.includeBackgroundImages,
            includeDataUrls: options.includeDataUrls,
          };
        };

        response.addCode(`// Extract image URLs from ${params.element}`);
        const imageData = await locator.evaluate(extractImageFunction, { includeBackgroundImages, includeDataUrls, searchDepth });
        console.log('Extracted Image URLs: ', imageData);

        const summary = `Found ${imageData.totalFound} image(s) in ${element}:\n\n` +
            imageData.images.map((img, index) =>
              `${index + 1}. [${img.type.toUpperCase()}] ${img.url}\n` +
                `   Element: ${img.element}` +
                (img.alt ? `\n   Alt: ${img.alt}` : '') +
                (img.title ? `\n   Title: ${img.title}` : '')
            ).join('\n\n');

        response.addResult(JSON.stringify(imageData));

      } catch (error) {
        response.addCode(`// Failed to extract image URLs from ${params.element}`);
        const errorMessage = `Failed to extract image URLs from ${element}. Error: ${error instanceof Error ? error.message : String(error)}`;
        response.addResult(errorMessage);
      }
    });
  },
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

export const validateStylesSchema = z.object({
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


const validate_computed_styles = defineTabTool({
  capability: 'core',
  schema: {
    name: 'validate_computed_styles',
    title: 'Validate computed styles of element',
    description:
      "Validate element's CSS computed styles against expected values using isEqual / notEqual / inRange operators. Supports RGB color range validation for color properties.",
    inputSchema: validateStylesSchema,
    type: 'readOnly',
  },
  handle: async (tab, rawParams, response) => {
    const { ref, element, checks } = validateStylesSchema.parse(rawParams);

    await tab.waitForCompletion(async () => {
      // Get locator
      const locator = await tab.refLocator({ ref, element });

      // Helper function to create evidence command
      const createEvidenceCommand = (locatorString: string, property: string, operator: string, expected?: any) => JSON.stringify({
        description: "Evidence showing how validation was performed",
        toolName: 'validate_computed_styles',
        locator: locatorString,
        arguments: {
          property,
          operator,
          expected: expected !== undefined ? expected : null
        }
      });

      // Check if element is attached to DOM with timeout
      try {
        await expect(locator).toBeAttached({ timeout: ELEMENT_ATTACHED_TIMEOUT });
      } catch (error) {
        // If element not found, generate payload with error and return early
        // Generate locator string for evidence (even if element not found, try to get locator string)
        let locatorString = '';
        
        locatorString = await generateLocatorString(ref, locator);

        const evidence = checks.map(check => ({
          command: createEvidenceCommand(locatorString, check.name, check.operator, check.expected),
          message: `CSS Property "${check.name}" validation failed: UI element not found`
        }));

        const payload = {
          ref,
          element,
          summary: {
            total: checks.length,
            passed: 0,
            failed: checks.length,
            status: 'fail' as const,
            evidence,
          },
          checks: checks.map(c => ({
            style: c.name,
            operator: c.operator,
            expected: c.expected,
            actual: undefined,
            result: 'fail' as const,
          })),
        };

        console.log('Validate Computed Styles (element not found):', payload);
        response.addResult(JSON.stringify(payload, null, 2));
        return;
      }

      // Generate locator string after element is confirmed to be attached
      const locatorString = await generateLocatorString(ref, locator);

      // 1) Get all computed styles directly
      let allStyles: any;
      try {
        allStyles = await getAllComputedStylesDirect(tab, ref, element);
      } catch (error) {
        // If getting styles fails, use empty object (element is confirmed to exist from toBeAttached check)
        allStyles = {};
      }
      //console.log("All Computed Styles:", allStyles);
      // 2) Validate rules
      const results = checks.map(c => {
            const actual = pickActualValue(allStyles, c.name);

            let passed: boolean;
            if (c.operator === 'isEqual') {
              // isEqual operator: strict equality only
              if (typeof c.expected === 'string' && (c.name.toLowerCase().includes('color') || c.name.toLowerCase().includes('background'))) {
                // For color properties, check if expected is in RGB format
                const expectedRGB = parseRGBColor(c.expected);
                const actualRGB = parseRGBColor(actual || '');

                if (expectedRGB && actualRGB) {
                  // Compare RGB values with some tolerance for minor variations
                  const tolerance = 5; // Allow small variations in RGB values
                  passed = Math.abs(expectedRGB.r - actualRGB.r) <= tolerance &&
                          Math.abs(expectedRGB.g - actualRGB.g) <= tolerance &&
                          Math.abs(expectedRGB.b - actualRGB.b) <= tolerance;
                } else {
                  // Fallback to strict equality if RGB parsing fails
                  passed = actual === c.expected;
                }
              } else {
                // For non-color properties: strict equality
                passed = actual === c.expected;
              }
            } else if (c.operator === 'notEqual') {
              // notEqual operator: strict inequality
              passed = actual !== c.expected;
            } else if (c.operator === 'inRange') {
              // inRange operator: check if value is in list or RGB color is within range
              if (Array.isArray(c.expected)) {
                // For inRange with array: any matching value passes
                passed = actual !== undefined && c.expected.includes(actual);
              } else if (typeof c.expected === 'object' && 'minR' in c.expected) {
                // For inRange with RGB range object: check if color is within range
                passed = actual !== undefined && isColorInRange(actual, c.expected as { minR: number; maxR: number; minG: number; maxG: number; minB: number; maxB: number });
              } else {
                passed = false; // Invalid expected value - inRange only supports arrays and RGB range objects
              }
            } else {
              passed = false; // Unknown operator
            }

            return {
              style: c.name,
              operator: c.operator,
              expected: c.expected,
              actual,
              result: passed ? 'pass' : 'fail',
            };
          });


      const passedCount = results.filter(r => r.result === 'pass').length;

      // Generate evidence as array of objects
      const evidence = results.map(result => {
            const expectedValue = typeof result.expected === 'object' ? JSON.stringify(result.expected) : result.expected;
            const message = result.result === 'pass'
              ? `CSS Property "${result.style}" validation passed: actual value "${result.actual}" ${result.operator === 'isEqual' ? 'equals' : result.operator === 'notEqual' ? 'does not equal' : 'is in range'} expected "${expectedValue}"`
              : `CSS Property "${result.style}" validation failed: actual value "${result.actual}" ${result.operator === 'isEqual' ? 'does not equal' : result.operator === 'notEqual' ? 'equals' : 'is not in range'} expected "${expectedValue}"`;
            
            return {
              command: createEvidenceCommand(locatorString, result.style, result.operator, result.expected),
              message
            };
          });

      // 3) Answer
      const payload = {
        ref,
        element,
        summary: {
          total: results.length,
          passed: passedCount,
          failed: results.length - passedCount,
          status: passedCount === results.length ? 'pass' : 'fail',
          evidence,
        },
        checks: results,
      };

      console.log('Validate Computed Styles:', payload);
      response.addResult(JSON.stringify(payload, null, 2));
    });
  },
});


const baseDomInputSchema = z.object({
  ref: z.string().min(1),
  element: z.string().min(1).describe('Description of the specific element with the given ref'),
});

// Individual assertion argument schemas
const toBeAttachedArgsSchema = z.object({
  options: z.object({
    attached: z.boolean().optional().describe('Whether the element should be attached to Document or ShadowRoot'),
  }).optional(),
});

const toBeCheckedArgsSchema = z.object({
  options: z.object({
    checked: z.boolean().optional().describe('Provides state to assert for. Asserts for input to be checked by default. This option can\'t be used when indeterminate is set to true.'),
    indeterminate: z.boolean().optional().describe('Asserts that the element is in the indeterminate (mixed) state. Only supported for checkboxes and radio buttons. This option can\'t be true when checked is provided.'),
  }).optional(),
});

const toBeDisabledArgsSchema = z.object({
  options: z.object({
  }).optional(),
});

const toBeEditableArgsSchema = z.object({
  options: z.object({
    editable: z.boolean().optional().describe('Whether the element should be editable'),
  }).optional(),
});

const toBeEmptyArgsSchema = z.object({
  options: z.object({
  }).optional(),
});

const toBeEnabledArgsSchema = z.object({
  options: z.object({
    enabled: z.boolean().optional().describe('Whether the element should be enabled'),
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
    visible: z.boolean().optional().describe('Whether the element should be visible'),
  }).optional(),
});

const toContainClassArgsSchema = z.object({
  expected: z.union([z.string(), z.array(z.string())]).describe('A string containing expected class names, separated by spaces, or a list of such strings to assert multiple elements'),
  options: z.object({
  }).optional(),
});

const toContainTextArgsSchema = z.object({
  expected: z.union([z.string(), z.instanceof(RegExp), z.array(z.union([z.string(), z.instanceof(RegExp)]))]).describe('Expected substring or RegExp or a list of those'),
  options: z.object({
    ignoreCase: z.boolean().optional().describe('Whether to perform case-insensitive match. ignoreCase option takes precedence over the corresponding regular expression flag if specified'),
    useInnerText: z.boolean().optional().describe('Whether to use element.innerText instead of element.textContent when retrieving DOM node text'),
  }).optional(),
});

const toHaveAccessibleDescriptionArgsSchema = z.object({
  description: z.union([z.string(), z.instanceof(RegExp)]).describe('Expected accessible description'),
  options: z.object({
    ignoreCase: z.boolean().optional().describe('Whether to perform case-insensitive match. ignoreCase option takes precedence over the corresponding regular expression flag if specified'),
  }).optional(),
});

const toHaveAccessibleErrorMessageArgsSchema = z.object({
  errorMessage: z.union([z.string(), z.instanceof(RegExp)]).describe('Expected accessible error message'),
  options: z.object({
    ignoreCase: z.boolean().optional().describe('Whether to perform case-insensitive match. ignoreCase option takes precedence over the corresponding regular expression flag if specified'),
  }).optional(),
});

const toHaveAccessibleNameArgsSchema = z.object({
  name: z.union([z.string(), z.instanceof(RegExp)]).describe('Expected accessible name'),
  options: z.object({
    ignoreCase: z.boolean().optional().describe('Whether to perform case-insensitive match. ignoreCase option takes precedence over the corresponding regular expression flag if specified'),
  }).optional(),
});

const toHaveAttributeArgsSchema = z.object({
  name: z.string().describe('Attribute name'),
  value: z.union([z.string(), z.instanceof(RegExp)]).optional().describe('Expected attribute value. If not provided, only checks that attribute exists'),
  options: z.object({
    ignoreCase: z.boolean().optional().describe('Whether to perform case-insensitive match when checking attribute value. Only applicable when "value" is provided. Ignored if "value" is not specified. ignoreCase option takes precedence over the corresponding regular expression flag if specified'),
  }).optional(),
});

const toHaveClassArgsSchema = z.object({
  expected: z.union([z.string(), z.instanceof(RegExp), z.array(z.union([z.string(), z.instanceof(RegExp)]))]).describe('Expected class or RegExp or a list of those'),
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
  value: z.union([z.string(), z.instanceof(RegExp)]).describe('CSS property value'),
  options: z.object({
  }).optional(),
});

const toHaveIdArgsSchema = z.object({
  id: z.union([z.string(), z.instanceof(RegExp)]).describe('Element id'),
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
  expected: z.union([z.string(), z.instanceof(RegExp), z.array(z.union([z.string(), z.instanceof(RegExp)]))]).describe('Expected string or RegExp or a list of those'),
  options: z.object({
    ignoreCase: z.boolean().optional().describe('Whether to perform case-insensitive match. ignoreCase option takes precedence over the corresponding regular expression flag if specified'),
    useInnerText: z.boolean().optional().describe('Whether to use element.innerText instead of element.textContent when retrieving DOM node text'),
  }).optional(),
});


const toHaveValueArgsSchema = z.object({
  value: z.union([z.string(), z.instanceof(RegExp)]).describe('Expected value'),
  options: z.object({
  }).optional(),
});

const toHaveValuesArgsSchema = z.object({
  values: z.array(z.union([z.string(), z.instanceof(RegExp)])).describe('Expected options currently selected'),
  options: z.object({
  }).optional(),
});

const selectHasValueArgsSchema = z.object({
  value: z.string().describe('Expected value (case and space insensitive)'),
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


const validate_dom_assertions = defineTabTool({
  capability: 'core',
  schema: {
    name: 'validate_dom_assertions',
    title: 'Validate DOM properties using Playwright assertions',
    description: 'Validate DOM properties using Playwright expect assertions (toBeEnabled, toBeDisabled, toBeVisible, etc.).',
    inputSchema: validateDomAssertionsSchema,
    type: 'readOnly',
  },
  handle: async (tab, rawParams, response) => {
    const { ref, element, checks } = validateDomAssertionsSchema.parse(rawParams);

    await tab.waitForCompletion(async () => {
      const locator = await tab.refLocator({ ref, element });
      const results = [];

      for (const check of checks) {
        const { negate, assertion: args } = check;
        if (!args || !args.assertionType) {
          throw new Error('Each check must have assertion with assertionType');
        }
        // Convert string RegExp patterns to actual RegExp objects
        const convertedArgs = convertStringToRegExp(args);
        //console.log('convertedArgs', convertedArgs);
        const { assertionType: name } = convertedArgs;
        // Get message for current assertion with element description
        const message : string = getAssertionMessage(name, element, negate);
        // Prepare final args - separate main arguments from options
        const { options, ...mainArgs } = convertedArgs;
        const finalOptions = { ...options, timeout: ELEMENT_ATTACHED_TIMEOUT };
        
        let result = {
          assertion: name,
          negate,
          result: 'fail' as 'pass' | 'fail',
          evidence: {message: '', command: ''},
          error: '',
          actual: '',
          arguments: args,
        };

        let locatorString: string = '';
        const createEvidenceCommand = (locatorStr: string) => JSON.stringify({
          description: "Evidence showing how validation was performed",
          assertion: name,
          locator: locatorStr,
          arguments: Object.keys(mainArgs).length > 1 ? mainArgs : {},
          options: Object.keys(finalOptions).length > 0 ? finalOptions : {}
        });
        try {
          // Create the assertion with message
          const assertion = message 
            ? (negate ? expect(locator, message).not : expect(locator, message))
            : (negate ? expect(locator).not : expect(locator));

          // Helper function to create evidence command
          

          // Execute the specific assertion by calling the method dynamically
          let assertionResult;
          switch (name) {
            case 'toBeEnabled':
              if (!convertedArgs || convertedArgs.assertionType !== 'toBeEnabled') {
                throw new Error('toBeEnabled requires proper arguments structure');
              }
              assertionResult = await assertion.toBeEnabled(finalOptions);
              result.actual = 'enabled';
              
              locatorString = await generateLocatorString(ref, locator);
              result.evidence.message = getAssertionEvidence(name, negate, locatorString, element, mainArgs, options);
              result.evidence.command = createEvidenceCommand(locatorString);
              break;

            case 'toBeDisabled':
              if (!args || args.assertionType !== 'toBeDisabled') {
                throw new Error('toBeDisabled requires proper arguments structure');
              }
              assertionResult = await assertion.toBeDisabled(finalOptions);
              result.actual = 'disabled';
              locatorString = await generateLocatorString(ref, locator);
              result.evidence.message = getAssertionEvidence(name, negate, locatorString, element, mainArgs);
              result.evidence.command = createEvidenceCommand(locatorString);
              break;

            case 'toBeVisible':
              if (!args || args.assertionType !== 'toBeVisible') {
                throw new Error('toBeVisible requires proper arguments structure');
              }
              assertionResult = await assertion.toBeVisible(finalOptions);
              result.actual = 'visible';
              locatorString = await generateLocatorString(ref, locator);
              result.evidence.message = getAssertionEvidence(name, negate, locatorString, element, mainArgs, options);
              result.evidence.command = createEvidenceCommand(locatorString);
              break;

            case 'toBeHidden':
              if (!args || args.assertionType !== 'toBeHidden') {
                throw new Error('toBeHidden requires proper arguments structure');
              }
              assertionResult = await assertion.toBeHidden(finalOptions);
              result.actual = 'hidden';
              locatorString = await generateLocatorString(ref, locator);
              result.evidence.message = getAssertionEvidence(name, negate, locatorString, element, mainArgs);
              result.evidence.command = createEvidenceCommand(locatorString);
              break;

            case 'toBeInViewport':
              if (!args || args.assertionType !== 'toBeInViewport') {
                throw new Error('toBeInViewport requires proper arguments structure');
              }
              assertionResult = await assertion.toBeInViewport(finalOptions);
              result.actual = 'in viewport';
              locatorString = await generateLocatorString(ref, locator);
              result.evidence.message = getAssertionEvidence(name, negate, locatorString, element, mainArgs);
              result.evidence.command = createEvidenceCommand(locatorString);
              break;

            case 'toBeChecked':
              if (!args || args.assertionType !== 'toBeChecked') {
                throw new Error('toBeChecked requires proper arguments structure');
              }
              assertionResult = await assertion.toBeChecked(finalOptions);
              result.actual = 'checked';
              locatorString = await generateLocatorString(ref, locator);
              result.evidence.message = getAssertionEvidence(name, negate, locatorString, element, mainArgs, options);
              result.evidence.command = createEvidenceCommand(locatorString);
              break;


            case 'toBeFocused':
              if (!args || args.assertionType !== 'toBeFocused') {
                throw new Error('toBeFocused requires proper arguments structure');
              }
              assertionResult = await assertion.toBeFocused(finalOptions);
              result.actual = 'focused';
              locatorString = await generateLocatorString(ref, locator);
              result.evidence.message = getAssertionEvidence(name, negate, locatorString, element, mainArgs);
              result.evidence.command = createEvidenceCommand(locatorString);
              break;

            case 'toBeEditable':
              if (!args || args.assertionType !== 'toBeEditable') {
                throw new Error('toBeEditable requires proper arguments structure');
              }
              assertionResult = await assertion.toBeEditable(finalOptions);
              result.actual = 'editable';
              locatorString = await generateLocatorString(ref, locator);
              result.evidence.message = getAssertionEvidence(name, negate, locatorString, element, mainArgs, options);
              result.evidence.command = createEvidenceCommand(locatorString);
              break;

            case 'toBeEmpty':
              if (!args || args.assertionType !== 'toBeEmpty') {
                throw new Error('toBeEmpty requires proper arguments structure');
              }
              assertionResult = await assertion.toBeEmpty(finalOptions);
              result.actual = 'empty';
              locatorString = await generateLocatorString(ref, locator);
              result.evidence.message = getAssertionEvidence(name, negate, locatorString, element, mainArgs);
              result.evidence.command = createEvidenceCommand(locatorString);
              break;

            case 'toBeAttached':
              if (!args || args.assertionType !== 'toBeAttached') {
                throw new Error('toBeAttached requires proper arguments structure');
              }
              assertionResult = await assertion.toBeAttached(finalOptions);
              result.actual = 'attached';
              locatorString = await generateLocatorString(ref, locator);
              result.evidence.message = getAssertionEvidence(name, negate, locatorString, element, mainArgs, options);
              result.evidence.command = createEvidenceCommand(locatorString);
              break;

            case 'toHaveAttribute':
              if (!args || args.assertionType !== 'toHaveAttribute') {
                throw new Error('toHaveAttribute requires proper arguments structure');
              }
              const { name: attrName, value: attrValue } = mainArgs;
              if (!attrName) {
                throw new Error('toHaveAttribute requires "name" argument (string)');
              }
              // If value is provided, check attribute with value; otherwise, just check existence
              // ignoreCase option is only applicable when checking value, so exclude it when value is not provided
              let attributeOptions = finalOptions;
              if (attrValue === undefined && finalOptions.ignoreCase !== undefined) {
                const { ignoreCase, ...optionsWithoutIgnoreCase } = finalOptions;
                attributeOptions = optionsWithoutIgnoreCase;
              }
              if (attrValue !== undefined) {
                assertionResult = await assertion.toHaveAttribute(attrName, attrValue, attributeOptions);
                result.actual = `attribute "${attrName}"="${attrValue}"`;
              } else {
                assertionResult = await assertion.toHaveAttribute(attrName, attributeOptions);
                result.actual = `attribute "${attrName}" exists`;
              }
              locatorString = await generateLocatorString(ref, locator);
              result.evidence.message = getAssertionEvidence(name, negate, locatorString, element, mainArgs);
              // Use attributeOptions (which excludes ignoreCase when value is not provided) for evidence
              result.evidence.command = JSON.stringify({
                description: "Evidence showing how validation was performed",
                assertion: name,
                locator: locatorString,
                arguments: Object.keys(mainArgs).length > 1 ? mainArgs : {},
                options: Object.keys(attributeOptions).length > 0 ? attributeOptions : {}
              });
              break;

            case 'toHaveText':
              if (!args || args.assertionType !== 'toHaveText') {
                throw new Error('toHaveText requires proper arguments structure');
              }
              const { expected: textExpected } = mainArgs;
              if (!textExpected) {
                throw new Error('toHaveText requires "expected" argument (string, RegExp, or Array<string | RegExp>)');
              }
              assertionResult = await assertion.toHaveText(textExpected, finalOptions);
              result.actual = `text "${Array.isArray(textExpected) ? textExpected.join(', ') : textExpected}"`;
              locatorString = await generateLocatorString(ref, locator);
              result.evidence.message = getAssertionEvidence(name, negate, locatorString, element, mainArgs);
              result.evidence.command = createEvidenceCommand(locatorString);
              break;

            case 'toContainText':
              if (!args || args.assertionType !== 'toContainText') {
                throw new Error('toContainText requires proper arguments structure');
              }
              const { expected: containExpected } = mainArgs;
              if (!containExpected) {
                throw new Error('toContainText requires "expected" argument (string, RegExp, or Array<string | RegExp>)');
              }
              assertionResult = await assertion.toContainText(containExpected, finalOptions);
              result.actual = `contains text "${Array.isArray(containExpected) ? containExpected.join(', ') : containExpected}"`;
              locatorString = await generateLocatorString(ref, locator);
              result.evidence.message = getAssertionEvidence(name, negate, locatorString, element, mainArgs);
              result.evidence.command = createEvidenceCommand(locatorString);
              break;

            case 'toHaveValue':
              if (!args || args.assertionType !== 'toHaveValue') {
                throw new Error('toHaveValue requires proper arguments structure');
              }
              const { value: valueExpected } = mainArgs;
              if (valueExpected === undefined) {
                throw new Error('toHaveValue requires "value" argument (string or RegExp)');
              }
              assertionResult = await assertion.toHaveValue(valueExpected, finalOptions);
              result.actual = `value "${valueExpected}"`;
              locatorString = await generateLocatorString(ref, locator);
              result.evidence.message = getAssertionEvidence(name, negate, locatorString, element, mainArgs);
              result.evidence.command = createEvidenceCommand(locatorString);
              break;

            case 'toHaveValues':
              if (!args || args.assertionType !== 'toHaveValues') {
                throw new Error('toHaveValues requires proper arguments structure');
              }
              const { values: valuesExpected } = mainArgs;
              if (!valuesExpected || !Array.isArray(valuesExpected)) {
                throw new Error('toHaveValues requires "values" argument (Array<string | RegExp>)');
              }
              assertionResult = await assertion.toHaveValues(valuesExpected, finalOptions);
              result.actual = `values [${valuesExpected.join(', ')}]`;
              locatorString = await generateLocatorString(ref, locator);
              result.evidence.message = getAssertionEvidence(name, negate, locatorString, element, mainArgs);
              result.evidence.command = createEvidenceCommand(locatorString);
              break;

            case 'selectHasValue':
              if (!args || args.assertionType !== 'selectHasValue') {
                throw new Error('selectHasValue requires proper arguments structure');
              }
              const { value: selectValueExpected } = mainArgs;
              if (selectValueExpected === undefined) {
                throw new Error('selectHasValue requires "value" argument (string)');
              }
              const normalizedExpected = normalizeValue(selectValueExpected);

              // Use expect.poll to retry the assertion with timeout
              const pollFn = async () => {
                const actualValue = await locator.inputValue();
                const normalizedActual = normalizeValue(actualValue);
                return { actualValue, normalizedActual };
              };

              const pollFnDeep = async () => {
                return await locator.evaluate((el: Element) => {
                  // <select> element
                  if (el instanceof HTMLSelectElement) {
                    const selected = el.selectedOptions[0];
                    return {
                      rawValue: el.value,
                      displayText: selected?.textContent ?? '',
                    };
                  }
                  // <input> (MUI / headless UI combobox)
                  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
                    return {
                      rawValue: el.value,
                      displayText: el.value,
                    };
                  }
                  // Fallback: try text content
                  return {
                    rawValue: (el as HTMLElement).innerText || (el as HTMLElement).textContent || '',
                    displayText: (el as HTMLElement).innerText || (el as HTMLElement).textContent || '',
                  };
                });
              };

              const selectTimeout = finalOptions?.timeout || ELEMENT_ATTACHED_TIMEOUT;
              const startTime = Date.now();
              let lastError: Error | null = null;
              let lastActualValue = '';
              let lastNormalizedActual = '';
              let found = false;
              while (Date.now() - startTime < selectTimeout) {
                try {
                  const { actualValue, normalizedActual } = await pollFn();
                  lastActualValue = actualValue;
                  lastNormalizedActual = normalizedActual;

                  if (negate) {
                    // For negated assertions, values should NOT match
                    if (normalizedExpected === normalizedActual) {
                      throw new Error(`Expected select value to not be "${selectValueExpected}" (normalized: "${normalizedExpected}"), but got "${actualValue}" (normalized: "${normalizedActual}")`);
                    }
                    // Values don't match, assertion passes
                    break;
                  } else {
                    // For normal assertions, values should match
                    if (normalizedExpected === normalizedActual) {
                      // Values match, assertion passes
                      found = true;
                      break;
                    }
                    // Values don't match yet, will retry
                    throw new Error(`Expected select value to be "${selectValueExpected}" (normalized: "${normalizedExpected}"), but got "${actualValue}" (normalized: "${normalizedActual}")`);
                  }
                } catch (error) {
                  lastError = error instanceof Error ? error : new Error(String(error));
                  try {
                    // workground for hot fix to check select value in deep
                    const { rawValue, displayText } = await pollFnDeep();
                    let normalizedRawValue = normalizeValue(rawValue);
                    let normalizedDisplayText = normalizeValue(displayText);
                    if (normalizedExpected === normalizedRawValue || normalizedExpected === normalizedDisplayText) {
                      found = true;
                      break;
                    }
                  } catch (error) {
                    // not sure how log here, but just ignore
                  }

                  // If timeout hasn't expired, wait a bit and retry
                  if (Date.now() - startTime < selectTimeout) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                    continue;
                  }
                  // Timeout expired, throw the last error
                  throw lastError;
                }
              }

              if (!found) {
                throw lastError;
              }

              // If we get here and it's a negated assertion that didn't throw, it means values matched when they shouldn't
              if (negate && normalizedExpected === lastNormalizedActual) {
                throw new Error(`Expected select value to not be "${selectValueExpected}" (normalized: "${normalizedExpected}"), but got "${lastActualValue}" (normalized: "${lastNormalizedActual}")`);
              }

              // Use a simple assertion that always passes when values match (or don't match for negated)
              assertionResult = await assertion.toBeAttached(finalOptions);
              result.actual = `value "${lastActualValue}" (normalized: "${lastNormalizedActual}")`;
              locatorString = await generateLocatorString(ref, locator);
              result.evidence.message = getAssertionEvidence(name, negate, locatorString, element, mainArgs);
              result.evidence.command = createEvidenceCommand(locatorString);
              break;

            case 'toMatchAriaSnapshot':
              if (!args || args.assertionType !== 'toMatchAriaSnapshot') {
                throw new Error('toMatchAriaSnapshot requires proper arguments structure');
              }
              const { expected: ariaSnapshotExpected } = mainArgs;
              if (!ariaSnapshotExpected) {
                throw new Error('toMatchAriaSnapshot requires "expected" argument (string)');
              }
              assertionResult = await assertion.toMatchAriaSnapshot(ariaSnapshotExpected, finalOptions);
              result.actual = `aria snapshot "${ariaSnapshotExpected}"`;
              locatorString = await generateLocatorString(ref, locator);
              result.evidence.message = getAssertionEvidence(name, negate, locatorString, element, mainArgs);
              result.evidence.command = createEvidenceCommand(locatorString);
              break;

            case 'toMatchAriaSnapshotOptions':
              if (!args || args.assertionType !== 'toMatchAriaSnapshotOptions') {
                throw new Error('toMatchAriaSnapshotOptions requires proper arguments structure');
              }
              assertionResult = await assertion.toMatchAriaSnapshot(finalOptions);
              result.actual = 'aria snapshot (with options)';
              locatorString = await generateLocatorString(ref, locator);
              result.evidence.message = getAssertionEvidence(name, negate, locatorString, element, mainArgs);
              result.evidence.command = createEvidenceCommand(locatorString);
              break;

            case 'toContainClass':
              if (!args || args.assertionType !== 'toContainClass') {
                throw new Error('toContainClass requires proper arguments structure');
              }
              const { expected: containClassExpected } = mainArgs;
              if (!containClassExpected) {
                throw new Error('toContainClass requires "expected" argument (string or Array<string>)');
              }
              assertionResult = await assertion.toContainClass(containClassExpected, finalOptions);
              result.actual = `contains class "${Array.isArray(containClassExpected) ? containClassExpected.join(' ') : containClassExpected}"`;
              locatorString = await generateLocatorString(ref, locator);
              result.evidence.message = getAssertionEvidence(name, negate, locatorString, element, mainArgs);
              result.evidence.command = createEvidenceCommand(locatorString);
              break;

            case 'toHaveClass':
              if (!args || args.assertionType !== 'toHaveClass') {
                throw new Error('toHaveClass requires proper arguments structure');
              }
              const { expected: classExpected } = mainArgs;
              if (!classExpected) {
                throw new Error('toHaveClass requires "expected" argument (string, RegExp, or Array<string | RegExp>)');
              }
              assertionResult = await assertion.toHaveClass(classExpected, finalOptions);
              result.actual = `class "${Array.isArray(classExpected) ? classExpected.join(' ') : classExpected}"`;
              locatorString = await generateLocatorString(ref, locator);
              result.evidence.message = getAssertionEvidence(name, negate, locatorString, element, mainArgs);
              result.evidence.command = createEvidenceCommand(locatorString);
              break;

            case 'toHaveCount':
              if (!args || args.assertionType !== 'toHaveCount') {
                throw new Error('toHaveCount requires proper arguments structure');
              }
              const { count } = mainArgs;
              if (count === undefined) {
                throw new Error('toHaveCount requires "count" argument (number)');
              }
              assertionResult = await assertion.toHaveCount(count, finalOptions);
              result.actual = `count ${count}`;
              locatorString = await generateLocatorString(ref, locator);
              result.evidence.message = getAssertionEvidence(name, negate, locatorString, element, mainArgs);
              result.evidence.command = createEvidenceCommand(locatorString);
              break;

            case 'toHaveCSS':
              if (!args || args.assertionType !== 'toHaveCSS') {
                throw new Error('toHaveCSS requires proper arguments structure');
              }
              const { name: cssName, value: cssValue } = mainArgs;
              if (!cssName || !cssValue) {
                throw new Error('toHaveCSS requires "name" and "value" arguments');
              }
              assertionResult = await assertion.toHaveCSS(cssName, cssValue, finalOptions);
              result.actual = `CSS ${cssName}="${cssValue}"`;
              locatorString = await generateLocatorString(ref, locator);
              result.evidence.message = getAssertionEvidence(name, negate, locatorString, element, mainArgs);
              result.evidence.command = createEvidenceCommand(locatorString);
              break;

            case 'toHaveId':
              if (!args || args.assertionType !== 'toHaveId') {
                throw new Error('toHaveId requires proper arguments structure');
              }
              const { id } = mainArgs;
              if (!id) {
                throw new Error('toHaveId requires "id" argument (string or RegExp)');
              }
              assertionResult = await assertion.toHaveId(id, finalOptions);
              result.actual = `id "${id}"`;
              locatorString = await generateLocatorString(ref, locator);
              result.evidence.message = getAssertionEvidence(name, negate, locatorString, element, mainArgs);
              result.evidence.command = createEvidenceCommand(locatorString);
              break;

            case 'toHaveJSProperty':
              if (!args || args.assertionType !== 'toHaveJSProperty') {
                throw new Error('toHaveJSProperty requires proper arguments structure');
              }
              const { name: jsPropertyName, value: jsPropertyValue } = mainArgs;
              if (!jsPropertyName || jsPropertyValue === undefined) {
                throw new Error('toHaveJSProperty requires "name" and "value" arguments');
              }
              assertionResult = await assertion.toHaveJSProperty(jsPropertyName, jsPropertyValue, finalOptions);
              result.actual = `JS property ${jsPropertyName}="${JSON.stringify(jsPropertyValue)}"`;
              locatorString = await generateLocatorString(ref, locator);
              result.evidence.message = getAssertionEvidence(name, negate, locatorString, element, mainArgs);
              result.evidence.command = createEvidenceCommand(locatorString);
              break;

            case 'toHaveRole':
              if (!args || args.assertionType !== 'toHaveRole') {
                throw new Error('toHaveRole requires proper arguments structure');
              }
              const { role } = mainArgs;
              if (!role) {
                throw new Error('toHaveRole requires "role" argument (ARIA role)');
              }
              assertionResult = await assertion.toHaveRole(role, finalOptions);
              result.actual = `role "${role}"`;
              locatorString = await generateLocatorString(ref, locator);
              result.evidence.message = getAssertionEvidence(name, negate, locatorString, element, mainArgs);
              result.evidence.command = createEvidenceCommand(locatorString);
              break;

            case 'toHaveScreenshot':
              if (!args || args.assertionType !== 'toHaveScreenshot') {
                throw new Error('toHaveScreenshot requires proper arguments structure');
              }
              const { name: screenshotName } = mainArgs;
              // If name is provided, check screenshot with name; otherwise, check with options only
              if (screenshotName !== undefined) {
                assertionResult = await assertion.toHaveScreenshot(screenshotName, finalOptions);
                result.actual = `screenshot "${Array.isArray(screenshotName) ? screenshotName.join(', ') : screenshotName}"`;
              } else {
                assertionResult = await assertion.toHaveScreenshot(finalOptions);
                result.actual = 'screenshot (with options)';
              }
              locatorString = await generateLocatorString(ref, locator);
              result.evidence.message = getAssertionEvidence(name, negate, locatorString, element, mainArgs);
              result.evidence.command = createEvidenceCommand(locatorString);
              break;


            case 'toHaveAccessibleDescription':
              if (!args || args.assertionType !== 'toHaveAccessibleDescription') {
                throw new Error('toHaveAccessibleDescription requires proper arguments structure');
              }
              const { description } = mainArgs;
              if (!description) {
                throw new Error('toHaveAccessibleDescription requires "description" argument');
              }
              assertionResult = await assertion.toHaveAccessibleDescription(description, finalOptions);
              result.actual = `accessible description "${description}"`;
              locatorString = await generateLocatorString(ref, locator);
              result.evidence.message = getAssertionEvidence(name, negate, locatorString, element, mainArgs);
              result.evidence.command = createEvidenceCommand(locatorString);
              break;

            case 'toHaveAccessibleErrorMessage':
              if (!args || args.assertionType !== 'toHaveAccessibleErrorMessage') {
                throw new Error('toHaveAccessibleErrorMessage requires proper arguments structure');
              }
              const { errorMessage } = mainArgs;
              if (!errorMessage) {
                throw new Error('toHaveAccessibleErrorMessage requires "errorMessage" argument (string or RegExp)');
              }
              assertionResult = await assertion.toHaveAccessibleErrorMessage(errorMessage, finalOptions);
              result.actual = `accessible error message "${errorMessage}"`;
              locatorString = await generateLocatorString(ref, locator);
              result.evidence.message = getAssertionEvidence(name, negate, locatorString, element, mainArgs);
              result.evidence.command = createEvidenceCommand(locatorString);
              break;

            case 'toHaveAccessibleName':
              if (!args || args.assertionType !== 'toHaveAccessibleName') {
                throw new Error('toHaveAccessibleName requires proper arguments structure');
              }
              const { name: accessibleName } = mainArgs;
              if (!accessibleName) {
                throw new Error('toHaveAccessibleName requires "name" argument (string or RegExp)');
              }
              assertionResult = await assertion.toHaveAccessibleName(accessibleName, finalOptions);
              result.actual = `accessible name "${accessibleName}"`;
              locatorString = await generateLocatorString(ref, locator);
              result.evidence.message = getAssertionEvidence(name, negate, locatorString, element, mainArgs);
              result.evidence.command = createEvidenceCommand(locatorString);
              break;

            default:
              throw new Error(`Unsupported assertion: ${name}`);
          }

          result.result = 'pass';
          console.log(`validate_dom_assertions: ${name}${negate ? ' (negated)' : ''} passed for element "${element}"`);

        } catch (error) {
          console.error('error in validate_dom_assertions', error);
          
          // Handle assertion errors - set result and evidence
          result.result = 'fail';
          result.error = error instanceof Error ? error.message : String(error);
          
          // Check if error indicates specific element issues (not found, multiple elements, etc.)
          const elementErrorMessage = getElementErrorMessage(error, element);
          const evidenceMessage = elementErrorMessage || getAssertionMessage(name, element, negate);
          locatorString = await generateLocatorString(ref, locator);
          result.evidence = {message: evidenceMessage, command: createEvidenceCommand(locatorString)};
         
        }

        results.push(result);
      }

      // Calculate summary
      const passedCount = results.filter(r => r.result === 'pass').length;
      const failedCount = results.length - passedCount;

      // Collect evidence from all results
      const evidence: {message: string, command: string}[] = [];
      for (const result of results) {
        if (result.evidence) {
          evidence.push(result.evidence);
        }
      }

      // Generate payload
      const payload = {
        ref,
        element,
        summary: {
          total: results.length,
          passed: passedCount,
          failed: failedCount,
          status: passedCount === results.length ? 'pass' : 'fail',
          evidence,
        },
        checks: results,
      };

      console.log('Validate DOM Assertions:');
      console.log(payload);
      response.addResult(JSON.stringify(payload, null, 2));
    });
  },
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

const validate_alert_in_snapshot = defineTabTool({
  capability: 'core',
  schema: {
    name: 'validate_alert_in_snapshot',
    title: 'Validate Alert in Snapshot',
    description: 'Validate if an alert dialog is present in the current page snapshot',
    inputSchema: checkAlertInSnapshotSchema,
    type: 'readOnly',
  },
  // clearsModalState: 'dialog',
  handle: async (tab, params, response) => {
    const { element, matchType, hasText } = checkAlertInSnapshotSchema.parse(params);

    try {
      // Get the current snapshot
      const tabSnapshot = await tab.captureSnapshot();

      // Check if alert dialog exists using modalStates
      const dialogState = tabSnapshot.modalStates.find(state => state.type === 'dialog');
      const alertExists = !!dialogState;
      // Get alert dialog text if it exists
      const alertText = dialogState ? dialogState.description : null;

      // Check text if hasText is provided and alert exists
      let textCheckPassed = true;
      let textCheckMessage = '';
      if (hasText && alertExists && alertText) {
        textCheckPassed = alertText.includes(hasText);
        textCheckMessage = textCheckPassed
          ? `Alert text contains expected text: "${hasText}"`
          : `Alert text does not contain expected text: "${hasText}". Actual text: "${alertText}"`;
        console.log('textCheckPassed:', textCheckPassed);
        console.log('textCheckMessage:', textCheckMessage);
      }

      // Apply match type logic
      let passed;
      if (matchType === 'contains')
        passed = alertExists && (hasText ? textCheckPassed : true);
      else if (matchType === 'not-contains')
        passed = !alertExists;

      console.log('passed:', passed);

      // Generate evidence message
      let evidenceMessage = '';
      if (matchType === 'contains') {
        if (passed) {
          if (hasText)
            evidenceMessage = `Alert dialog found with text: "${alertText}" containing expected: "${hasText}"`;
          else
            evidenceMessage = `Alert dialog found with text: "${alertText}"`;

        } else {
          if (hasText)
            evidenceMessage = `Alert dialog found but text "${hasText}" not found in: "${alertText}"`;
          else
            evidenceMessage = `Alert dialog not found in snapshot`;

        }
      } else { // not-contains
        if (passed)
          evidenceMessage = `Alert dialog was not found as expected`;
        else
          evidenceMessage = `Alert dialog was not expected, but it was ${hasText ? `found with text: "${alertText}"` : 'found'}.`;

      }

      // Generate evidence as array of objects
      const evidence = [{
        command: {
          toolName: 'validate_alert_in_snapshot',
          arguments: {
            expectedText: hasText || null,
            matchType: matchType
          }
        },
        message: evidenceMessage
      }];

      const payload = {
        element,
        matchType,
        hasText,
        alertExists,
        alertText,
        textCheckPassed,
        textCheckMessage,
        summary: {
          status: passed ? 'pass' : 'fail',
          evidence,
        },
        snapshot: {
          containsAlert: alertExists,
          snapshotLength: tabSnapshot.ariaSnapshot.length
        }
      };

      const resultString = JSON.stringify(payload, null, 2);
      // console.log('Result string:', resultString);
      response.addResult(resultString);
    } catch (error) {
      const errorMessage = `Failed to check alert dialog in snapshot.`;
      console.log(`Failed to check alert dialog in snapshot. Error: ${error instanceof Error ? error.message : String(error)}`)
      const errorEvidence = [{
        command: {
          toolName: 'validate_alert_in_snapshot',
          expectedText: hasText || null,
          matchType: matchType
        },
        message: errorMessage
      }];
      const errorPayload = {
        element,
        matchType,
        hasText,
        alertExists: false,
        alertText: null,
        textCheckPassed: false,
        textCheckMessage: '',
        summary: {
          status: 'error',
          evidence: errorEvidence
        },
        error: error instanceof Error ? error.message : String(error)
      };

      console.error('Check alert in snapshot error:', errorPayload);
      const errorResultString = JSON.stringify(errorPayload, null, 2);
      // console.log('Error result string:', errorResultString);
      response.addResult(errorResultString);
      console.log('Error result added to response');
      console.log('Function completed with error');
    }
  },
});

const default_validation = defineTabTool({
  capability: 'core',
  schema: {
    name: 'default_validation',
    title: 'Default Validation Tool',
    description: 'Default tool for when LLM cannot find a suitable tool. Accepts ref and JavaScript code to parse and execute.',
    inputSchema: z.object({
      ref: z.string().describe('Element reference from the page snapshot'),
      element: z.string().min(1).describe('Description of the specific element with the given ref'),
      jsCode: z.string().describe('JavaScript code to execute on the element. Function receives single element as parameter. Should return "pass" or "fail" as string. Do not use ref in the code - work directly with the element parameter.'),
    }),
    type: 'readOnly',
  },
  handle: async (tab, params, response) => {
    const { ref, element, jsCode } = params;

    await tab.waitForCompletion(async () => {
      try {
        // Get element locator
        const locator = await tab.refLocator({ ref, element });

        // Check if element is attached to DOM with timeout
        try {
          await expect(locator).toBeAttached({ timeout: ELEMENT_ATTACHED_TIMEOUT });
        } catch (error) {
          // Element not found, generate payload and return early
          let locatorString = await generateLocatorString(ref, locator);

          const evidence = [{
            command: JSON.stringify({
              toolName: 'default_validation',
              arguments: {
                jsCode: jsCode
              },
              locators: [{
                element: element,
                locatorString: locatorString
              }]
            }),
            message: `The UI Element "${element}" not found`
          }];

          const payload = {
            ref,
            element,
            summary: {
              total: 1,
              passed: 0,
              failed: 1,
              status: 'fail',
              evidence,
            },
            checks: [{
              property: 'javascript_execution',
              operator: 'execute',
              expected: 'success',
              actual: 'UI element not found',
              result: 'fail',
            }],
            result: 'fail',
            jsCode,
          };

          console.log('Default validation - UI element not found:', payload);
          response.addResult(JSON.stringify(payload, null, 2));
          return;
        }

        // Generate locator string after element is confirmed to be attached
        const locatorString = await generateLocatorString(ref, locator);
        
        // Execute the JavaScript code on the element
        const result = await locator.evaluate((element: Element, code: string) => {
          try {
            // Safe evaluation function
            const safeEval = (code: string, element: Element) => {
              const func = new Function('element', 'document', `
              'use strict';
              ${code}
            `);

              // Create safe context with necessary objects
              const safeContext = {
                element,
                document, // Keep document for element searching
                // Disable potentially dangerous functions
                console: { log: () => {}, warn: () => {}, error: () => {} },
                setTimeout: undefined,
                setInterval: undefined,
                eval: undefined,
                Function: undefined,
                // Keep limited window functionality
                window: {
                  innerWidth: window.innerWidth,
                  innerHeight: window.innerHeight,
                  localStorage: window.localStorage,
                  sessionStorage: window.sessionStorage
                }
              };

              return func.call(safeContext, element, document);
            };

            return safeEval(code, element);
          } catch (error) {
            return {
              error: error instanceof Error ? error.message : String(error),
              type: 'execution_error'
            };
          }
        }, jsCode);

        // Determine pass/fail based on result
        const isPass = result === 'pass' && !(result && typeof result === 'object' && 'error' in result);
        const status = isPass ? 'pass' : 'fail';
        const passed = isPass ? 1 : 0;
        const failed = isPass ? 0 : 1;

        // Generate evidence message
        const resultString = typeof result === 'object' ? JSON.stringify(result) : String(result);
        const evidenceMessage = isPass
          ? `Successfully executed JavaScript code on element "${element}". Result: ${resultString}`
          : `JavaScript code execution failed on element "${element}". Result: ${resultString}`;

        // Generate evidence as array of objects with command and message
        const evidence = [{
          command: JSON.stringify({
            toolName: 'default_validation',
            arguments: {
              jsCode: jsCode
            },
            locators: [{
              element: element,
              locatorString: locatorString
            }]
          }),
          message: evidenceMessage
        }];

        const payload = {
          ref,
          element,
          summary: {
            total: 1,
            passed,
            failed,
            status,
            evidence,
          },
          checks: [{
            property: 'javascript_execution',
            operator: 'execute',
            expected: 'success',
            actual: typeof result === 'object' ? JSON.stringify(result) : String(result),
            result: isPass ? 'pass' : 'fail',
          }],
          result,
          jsCode,
        };

        console.log('Default validation executed:', payload);
        response.addResult(JSON.stringify(payload, null, 2));

      } catch (error) {
        // Generate locator string for error case (try to generate even if execution failed)
        let locatorString = '';
        try {
          const locator = await tab.refLocator({ ref, element });
          locatorString = await generateLocatorString(ref, locator);
        } catch {
          // If locator generation fails, use empty string
          locatorString = '';
        }

        // Generate error evidence message
        const errorMessage = `Failed to execute JavaScript code on element "${element}".`;
        console.log(`Failed to execute JavaScript code on element "${element}". Error: ${error instanceof Error ? error.message : String(error)}`);

        // Generate evidence as array of objects with command and message
        const errorEvidence = [{
          command: JSON.stringify({
            toolName: 'default_validation',
            arguments: {
              jsCode: jsCode
            },
            locators: [{
              element: element,
              locatorString: locatorString
            }]
          }),
          message: errorMessage
        }];

        const errorPayload = {
          ref,
          element,
          summary: {
            total: 1,
            passed: 0,
            failed: 1,
            status: 'fail',
            evidence: errorEvidence,
          },
          checks: [{
            property: 'javascript_execution',
            operator: 'execute',
            expected: 'success',
            actual: error instanceof Error ? error.message : String(error),
            result: 'fail',
          }],
          error: error instanceof Error ? error.message : String(error),
          jsCode,
        };

        console.error('Default validation error:', errorPayload);
        response.addResult(JSON.stringify(errorPayload, null, 2));
      }
    });
  },
});


// const validate_response = defineTabTool({
//   capability: 'core',
//   schema: {
//     name: 'validate_response',
//     title: 'Validate Response using Regex Patterns',
//     description: 'Validate response data using regex patterns. Types: regex_extract (extract value with pattern), regex_match (check pattern presence).',
//     inputSchema: z.object({
//       responseData: z.string().describe('Response data as string (can be JSON with stdout/stderr or raw response)'),
//       checks: z.array(z.object({
//         type: z.enum(['regex_extract', 'regex_match']).describe('Type of validation check'),
//         name: z.string().describe('Name/description of the check for logging purposes'),
//         pattern: z.string().describe('Regex pattern to extract or match against'),
//         expected: z.any().optional().describe('Expected value for comparison (not needed for regex_match)'),
//         operator: z.enum(['equals', 'not_equals', 'contains', 'not_contains', 'greater_than', 'less_than']).optional().default('equals').describe('Comparison operator (not needed for regex_match)'),
//         extractGroup: z.number().optional().default(1).describe('Regex capture group to extract (default: 1, only for regex_extract)'),
//       })).min(1).describe('Array of validation checks to perform'),
//     }),
//     type: 'readOnly',
//   },
//   handle: async (tab, params, response) => {
//     const { responseData, checks } = params;

//     try {
//       // Perform all checks
//       const results = checks.map(check => {
//         const result = performRegexCheck(responseData, check);
//         return {
//           type: check.type,
//           name: check.name,
//           pattern: check.pattern,
//           expected: check.expected,
//           operator: check.operator,
//           extractGroup: check.extractGroup,
//           actual: result.actual,
//           result: result.passed ? 'pass' : 'fail',
//         };
//       });

//       const passedCount = results.filter(r => r.result === 'pass').length;
//       const status = passedCount === results.length ? 'pass' : 'fail';

//       // Generate evidence message
//       let evidence = '';
//       if (status === 'pass') {
//         evidence = `All ${results.length} regex validation checks passed successfully`;
//       } else {
//         const failedChecks = results.filter(r => r.result === 'fail');
//         const failedDetails = failedChecks.map(c =>
//           `${c.name} (pattern: ${c.pattern}, expected: ${c.expected}, got: ${c.actual})`
//         ).join(', ');
//         evidence = `${passedCount}/${results.length} checks passed. Failed: ${failedDetails}`;
//       }

//       const payload = {
//         responseData: responseData.length > 500 ? responseData.slice(0, 500) + '...' : responseData,
//         summary: {
//           total: results.length,
//           passed: passedCount,
//           failed: results.length - passedCount,
//           status,
//           evidence,
//         },
//         checks: results,
//       };

//       console.log('Validate cURL response regex:', payload);
//       response.addResult(JSON.stringify(payload, null, 2));

//     } catch (error) {
//       const errorPayload = {
//         responseData: responseData.length > 500 ? responseData.slice(0, 500) + '...' : responseData,
//         summary: {
//           total: checks.length,
//           passed: 0,
//           failed: checks.length,
//           status: 'fail',
//           evidence: `Failed to validate cURL response with regex. Error: ${error instanceof Error ? error.message : String(error)}`,
//         },
//         checks: checks.map(check => ({
//           type: check.type,
//           name: check.name,
//           pattern: check.pattern,
//           expected: check.expected,
//           operator: check.operator,
//           extractGroup: check.extractGroup,
//           actual: 'error',
//           result: 'fail',
//         })),
//         error: error instanceof Error ? error.message : String(error),
//       };

//       console.error('Validate cURL response regex error:', errorPayload);
//       response.addResult(JSON.stringify(errorPayload, null, 2));
//     }
//   },
// });

const validate_response = defineTabTool({
  capability: 'core',
  schema: {
    name: 'validate_response',
    title: 'Validate Response using JSON Path',
    description: 'Validate response object using JSON path expressions to extract and compare values.',
    inputSchema: z.object({
      responseData: z.string().describe('Response data as JSON string'),
      checks: z.array(z.object({
        name: z.string().describe('Name/description of the check for logging purposes'),
        jsonPath: z.string().describe('JSONPath expression. Examples: $.store.book[0].title (specific element), $..author (recursive descent), $.store.book[*].author (wildcard), $.store.book[?(@.price<10)] (filter), $.store.book[(@.length-1)] (script). Use $ as root, dot notation or brackets for properties.'),
        expected: z.any().optional().describe('Expected value for comparison'),
        operator: z.enum(['equals', 'not_equals', 'greater_than', 'less_than', 'hasValue']).optional().default('equals').describe('Comparison operator. hasValue checks if value exists at jsonPath (expected should be true/false)')
      })).min(1).describe('Array of validation checks to perform'),
    }),
    type: 'readOnly',
  },
  handle: async (tab, params, response) => {
    const { responseData, checks } = params;

    // Parse JSON string to object
    let parsedResponseData;
    try {
      parsedResponseData = JSON.parse(responseData);
    } catch (error) {
      const errorMessage = `Failed to parse responseData as JSON: ${error instanceof Error ? error.message : String(error)}`;

      const errorEvidence = [{
        command: JSON.stringify({
          toolName: 'validate_response',
          arguments: {
            checks: checks
          }
        }),
        message: errorMessage
      }];

      const errorPayload = {
        summary: {
          total: checks.length,
          passed: 0,
          failed: checks.length,
          status: 'fail',
          evidence: errorEvidence,
        },
        checks: checks.map(check => ({
          name: check.name,
          jsonPath: check.jsonPath,
          expected: check.expected,
          operator: check.operator,
          actual: 'error',
          result: 'fail',
        })),
        error: errorMessage,
      };

      console.error('Validate response JSON parse error:', errorPayload);
      response.addResult(JSON.stringify(errorPayload, null, 2));
      return;
    }

    // Perform all checks
    const results = checks.map(check => {
      try {
        // Extract value using JSON path
        const normalizedPath = check.jsonPath.startsWith('$') ? check.jsonPath : `$.${check.jsonPath}`;
        const queryResult = jp.query(parsedResponseData, normalizedPath);
        const actualValue = queryResult.length === 1 ? queryResult[0] : queryResult;

        // Compare values if expected is provided
        let passed = true;
        if (check.expected !== undefined) {
          const comparisonResult = compareValues(actualValue, check.expected, check.operator);
          passed = comparisonResult.passed;
        }

        return {
          name: check.name,
          jsonPath: check.jsonPath,
          expected: check.expected,
          operator: check.operator,
          actual: actualValue,
          result: passed ? 'pass' : 'fail',
        };
      } catch (error) {
        // Handle case when value is not found at JSON path
        return {
          name: check.name,
          jsonPath: check.jsonPath,
          expected: check.expected,
          operator: check.operator,
          actual: `ERROR: ${error.message}`,
          result: 'fail',
        };
      }
    });

    const passedCount = results.filter(r => r.result === 'pass').length;
    const status = passedCount === results.length ? 'pass' : 'fail';

    // Generate evidence message
    let evidenceMessage = '';
    if (status === 'pass') {
      evidenceMessage = `All ${results.length} JSON path validation checks passed successfully`;
    } else {
      const failedChecks = results.filter(r => r.result === 'fail');
      const failedDetails = failedChecks.map(c =>
        `${c.name} (path: ${c.jsonPath}, expected: ${c.expected}, got: ${c.actual})`
      ).join(', ');
      evidenceMessage = `${passedCount}/${results.length} checks passed. Failed: ${failedDetails}`;
    }

    // Generate evidence as array of objects with command and message
    const evidenceArray = [{
      command: JSON.stringify({
        toolName: 'validate_response',
        arguments: {
          checks: checks
        }
      }),
      message: evidenceMessage
    }];

    const payload = {
      summary: {
        total: results.length,
        passed: passedCount,
        failed: results.length - passedCount,
        status,
        evidence: evidenceArray,
      },
      checks: results,
    };

    console.log('Validate response JSON path:', payload);
    response.addResult(JSON.stringify(payload, null, 2));
  },
});

const generate_locator = defineTabTool({
  capability: 'core',
  schema: {
    name: 'generate_locator',
    title: 'Generate Playwright Locator from Ref',
    description: 'Generate a stable Playwright locator string from element ref using Playwright\'s built-in generateLocator function. Returns a single optimized locator string.',
    inputSchema: z.object({
      ref: z.string().describe('Element reference from page snapshot'),
      element: z.string().describe('Human-readable element description for logging'),
    }),
    type: 'readOnly',
  },
  handle: async (tab, params, response) => {
    const { ref, element } = params;

    try {
      await tab.waitForCompletion(async () => {
        // Get locator from ref
        // If ref starts with ###checkLocator, remove the prefix before passing to refLocator
        const refForLocator = ref.startsWith('###checkLocator') 
          ? ref.substring('###checkLocator'.length) 
          : ref;
        const locator = await tab.refLocator({ ref: refForLocator, element });

        // Always generate locator first
        let generatedLocator = await generateLocator(locator);
        let locatorType = 'playwright-generated';

        // If generated locator starts with getByText and ref has ###checkTextLocator prefix, use xpath instead
        if (ref.startsWith('###checkLocator')) {
          // Get xpath from element using getXPathCode from helperFunctions
          const xpathCode = getXPathCode();
          // Use evaluate with code from helperFunctions
          const xpath = await locator.evaluate((el: Element, code: string) => {
            const func = new Function('element', code);
            return func(el);
          }, xpathCode);
          // Return XPath in Playwright locator format: locator('xpath=...')
          const xpathSelector = `xpath=${xpath}`;
          generatedLocator = asLocator('javascript', xpathSelector);
          locatorType = 'xpath';
        }

        const payload = {
          ref,
          element,
          generatedLocator,
          summary: {
            status: 'success',
            message: `Successfully generated ${locatorType} locator for element "${element}" with ref "${ref}"`,
            locatorType,
            isStable: true,
            canBeReused: true,
          },
        };

        response.addResult(JSON.stringify(payload, null, 2));
      });
    } catch (error) {
      const errorPayload = {
        ref,
        element,
        summary: {
          status: 'error',
          message: `Failed to generate locator for element "${element}" with ref "${ref}". Error: ${error instanceof Error ? error.message : String(error)}.Snapshot:${JSON.stringify(await tab.captureSnapshot())}`,
        },
        error: error instanceof Error ? error.message : String(error),
      };

      console.error('Generate locator error:', errorPayload);
      response.addResult(JSON.stringify(errorPayload, null, 2));
    }
  },
});

const validate_tab_exist = defineTabTool({
  capability: 'core',
  schema: {
    name: 'validate_tab_exist',
    title: 'Validate Tab Exists',
    description: 'Check if a browser tab with the specified URL exists or does not exist. Use matchType "exist" to verify tab exists, or "not-exist" to verify tab does not exist. exactMatch is ignored when matchType is "not-exist". Optionally validate if the found tab is the current active tab with isCurrent parameter.',
    inputSchema: z.object({
      url: z.string().describe('URL to check for in existing browser tabs'),
      matchType: z.enum(['exist', 'not-exist']).describe('Whether to check if tab exists or does not exist'),
      exactMatch: z.boolean().optional().default(true).describe('Whether to require exact URL match (true) or partial match (false). Ignored when matchType is "not-exist"'),
      isCurrent: z.boolean().optional().describe('If true, also validates that the found tab is the current active tab'),
    }),
    type: 'readOnly',
  },
  handle: async (tab, params, response) => {
    const { url, matchType, exactMatch, isCurrent } = params;

    try {
      // Get all tabs information from context
      const context = tab.context;
      const allTabs = context.tabs();

      // Extract tab info using the correct page methods
      const tabsWithInfo = await Promise.all(allTabs.map(async (tabItem: any, index: number) => {
        try {
          // Get URL and title from page object
          const tabUrl = await tabItem.page.url() || 'unknown';
          const tabTitle = await tabItem.page.title() || 'Unknown';
          tab.page.getByText;
          return {
            index,
            header: tabTitle,
            url: tabUrl
          };
        } catch (error) {
          // Fallback if we can't get tab info
          return {
            index,
            header: 'Unknown',
            url: 'unknown'
          };
        }
      }));

      console.log('All tabs info:', tabsWithInfo);

      // Find current tab URL
      let currentTabUrl = '';
      try {
        currentTabUrl = await tab.page.url();
      } catch (error) {
        console.log('Could not determine current tab URL:', error);
      }

      let foundTab: any = null;
      let searchType = '';

      // Search for tab with matching URL
      if (exactMatch) {
        // Exact URL match
        foundTab = tabsWithInfo.find((tab: any) => tab.url === url);
        searchType = 'exact';
      } else {
        // Partial URL match
        foundTab = tabsWithInfo.find((tab: any) => tab.url.includes(url) || url.includes(tab.url));
        searchType = 'partial';
      }

      const isFound = !!foundTab;

      // Check if found tab is current tab (if isCurrent is specified)
      let isCurrentTab = false;
      if (isFound && isCurrent !== undefined)
        isCurrentTab = (foundTab as any).url === currentTabUrl;


      // Determine final result based on matchType and isCurrent
      let status: string;
      if (matchType === 'exist') {
        const urlMatch = isFound;
        const currentMatch = isCurrent === undefined ? true : (isCurrent ? isCurrentTab : !isCurrentTab);
        status = (urlMatch && currentMatch) ? 'pass' : 'fail';
      } else { // matchType === 'not-exist'
        const urlMatch = !isFound;
        const currentMatch = isCurrent === undefined ? true : (isCurrent ? isCurrentTab : !isCurrentTab);
        status = (urlMatch && currentMatch) ? 'pass' : 'fail';
      }

      // Generate evidence message
      let evidence = '';
      let currentInfo = '';
      if (isCurrent !== undefined) {
        if (isFound)
          currentInfo = ` Found tab is ${isCurrentTab ? '' : 'not '}current tab. Expected: ${isCurrent ? 'current' : 'not current'}.`;
        else
          currentInfo = ` Current tab check: ${isCurrent ? 'expected current tab not found' : 'expected non-current tab not found'}.`;

      }

      if (matchType === 'exist') {
        if (isFound && foundTab) {
          evidence = `Found tab with ${searchType} URL match: "${(foundTab as any).url}" (index: ${(foundTab as any).index}, header: "${(foundTab as any).header}")${currentInfo}`;
        } else {
          const availableUrls = tabsWithInfo.map((t: any) => (t as any).url).join(', ');
          evidence = `Tab with URL "${url}" not found. Available tabs: ${availableUrls}${currentInfo}`;
        }
      } else { // matchType === 'not-exist'
        if (!isFound)
          evidence = `Tab with URL "${url}" does not exist (as expected). Available tabs: ${tabsWithInfo.map((t: any) => (t as any).url).join(', ')}${currentInfo}`;
        else
          evidence = `Tab with URL "${url}" exists (unexpected). Found: "${(foundTab as any).url}" (index: ${(foundTab as any).index}, header: "${(foundTab as any).header}")${currentInfo}`;

      }

      // Generate evidence as array of objects with command and message
      const evidenceArray = [{
        command: JSON.stringify({
          toolName: 'validate_tab_exist',
          arguments: {
            url,
            matchType,
            exactMatch,
            isCurrent
          }
        }),
        message: evidence
      }];

      const payload = {
        url,
        matchType,
        exactMatch,
        isCurrent,
        currentTabUrl,
        isCurrentTab,
        foundTab: foundTab ? {
          index: (foundTab as any).index,
          header: (foundTab as any).header,
          url: (foundTab as any).url
        } : null,
        summary: {
          total: 1,
          passed: status === 'pass' ? 1 : 0,
          failed: status === 'pass' ? 0 : 1,
          status,
          evidence: evidenceArray,
        },
        allTabs: tabsWithInfo.map((t: any) => ({
          index: (t as any).index,
          header: (t as any).header,
          url: (t as any).url
        })),
      };
      console.log('Validate tab exist:', payload);
      response.addResult(JSON.stringify(payload, null, 2));

    } catch (error) {
      const errorMessage = `Failed to validate tab existence.`;
      console.log(`Failed to validate tab existence. Error: ${error instanceof Error ? error.message : String(error)}`);

      // Generate evidence as array of objects with command and message
      const errorEvidence = [{
        command: JSON.stringify({
          toolName: 'validate_tab_exist',
          arguments: {
            url,
            matchType,
            exactMatch,
            isCurrent
          }
        }),
        message: errorMessage
      }];

      const errorPayload = {
        url,
        exactMatch,
        summary: {
          total: 1,
          passed: 0,
          failed: 1,
          status: 'fail',
          evidence: errorEvidence,
        },
        error: error instanceof Error ? error.message : String(error),
      };
      console.error('Validate tab exist error:', errorPayload);
      response.addResult(JSON.stringify(errorPayload, null, 2));
    }
  },
});

const makeRequestSchema = z.object({
  command: z.string().describe('Actual finalized command'),
  evidence: z.string().describe('Command description'),
});

const make_request = defineTabTool({
  capability: 'core',
  schema: {
    name: 'make_request',
    title: 'Make HTTP request using curl command',
    description: 'Execute a curl command to make HTTP requests and return the response',
    inputSchema: makeRequestSchema,
    type: 'readOnly',
  },
  handle: async (tab, params, response) => {
    const { command, evidence } = makeRequestSchema.parse(params);


    let toolResult: any = {
      success: false,
      apiResponse: {
        data: '',
        statusCode: undefined,
        responseTime: undefined,
        contentLength: undefined,
        contentType: undefined,
        server: undefined,
        error: undefined,
        rawStderr: undefined
      }
    };

    try {
      const result = await runCommandClean(command);
      toolResult = {
        success: true,
        apiResponse: result
      };
    } catch (error) {
      toolResult = {
        success: false,
        apiResponse: {
          data: '',
          statusCode: undefined,
          responseTime: undefined,
          contentLength: undefined,
          contentType: undefined,
          server: undefined,
          error: error instanceof Error ? error.message : String(error),
          rawStderr: undefined
        }
      };
    }

    response.addResult(JSON.stringify(toolResult, null, 2));
  },
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
      'Expected text value to validate in the element or whole page'
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
  matchType: z.enum(['exist', 'not-exist']).default('exist').describe(
      "Type of match: 'exist' checks that element exists exactly once, 'not-exist' checks that element does not exist anywhere"
  ),
});

const dataExtractionSchema = z.object({
  name: z.string().describe('Variable name (will be prefixed with $$)'),
  data: z.string().describe('Data to extract from. If jsonPath is provided, should be JSON string. If jsonPath is not provided, can be any string data'),
  jsonPath: z.string().optional().describe('JSONPath expression. Examples: $.store.book[0].title (specific element), $..author (recursive descent), $.store.book[*].author (wildcard), $.store.book[?(@.price<10)] (filter), $.store.book[(@.length-1)] (script). Use $ as root, dot notation or brackets for properties.'),
});

const validate_text_in_whole_page = defineTabTool({
  capability: 'core',
  schema: {
    name: 'validate_text_in_whole_page',
    title: 'Validate text in whole page',
    description: 'Validate that text exists or does not exist anywhere on the page',
    inputSchema: validateTextInWholePageSchema,
    type: 'readOnly',
  },
  handle: async (tab, params, response) => {
    const { element, expectedText, matchType } = validateTextInWholePageSchema.parse(params);

    await tab.waitForCompletion(async () => {
      // Get locator for whole page and generate locator string
      const locatorString = 'page.locator("body")'

      // Helper function to create evidence command
      const createEvidenceCommand = () => JSON.stringify({
        description: "Evidence showing how validation was performed",
        toolName: 'validate_text_in_whole_page',
        locator: locatorString,
        args: {
          expectedText,
          matchType
        }
      });

      let passed = false;
      let evidenceMessage = '';
      let actualCount = 0;
      let foundFrames: string[] = [];

      try {
        // Use checkTextVisibilityInAllFrames to search across all frames
        const results = await checkTextVisibilityInAllFrames(tab.page, expectedText, matchType);

        // Count found results
        const foundResults = results.filter(result => result.found);
        actualCount = foundResults.length;
        foundFrames = foundResults.map(result => result.frame);

        // Determine if test passes based on matchType
        if (matchType === 'exact' || matchType === 'contains') {
          if (actualCount === 1) {
            passed = true;
            evidenceMessage = `The text "${expectedText}" was found once on the page using ${matchType} matching in frame: ${foundFrames[0]}.`;
          } else if (actualCount > 1) {
            passed = false;
            evidenceMessage = `The text "${expectedText}" appeared ${actualCount} times on the page using ${matchType} matching in frames: ${foundFrames.join(', ')}. Expected only one occurrence.`;
          } else {
            passed = false;
            evidenceMessage = `The text "${expectedText}" was not found on the page using ${matchType} matching.`;
          }
        } else { // not-contains
          if (actualCount === 0) {
            passed = true;
            evidenceMessage = `The text "${expectedText}" was correctly not found on the page using ${matchType} matching.`;
          } else {
            passed = false;
            evidenceMessage = `The text "${expectedText}" was found ${actualCount} time(s) on the page using ${matchType} matching in frames: ${foundFrames.join(', ')} — it should not appear.`;
          }
        }

      } catch (error) {
        passed = false;
        const errorMessage = error instanceof Error ? error.message : String(error);
        evidenceMessage = `Failed to validate text "${expectedText}" on the page.`;

        console.log(`Failed to validate text in whole page for "${element}". Error: ${errorMessage}`);
      }

      // Generate evidence as array with single object
      const evidence = [{
        command: createEvidenceCommand(),
        message: evidenceMessage
      }];

      // Generate final payload
      const payload = {
        element,
        expectedText,
        matchType,
        summary: {
          total: 1,
          passed: passed ? 1 : 0,
          failed: passed ? 0 : 1,
          status: passed ? 'pass' : 'fail',
          evidence,
        },
        checks: [{
          property: 'text-presence',
          operator: matchType,
          expected: matchType === 'not-contains' ? 'not-present' : 'present-once',
          actual: actualCount > 0 ? `present-${actualCount}-times` : 'not-present',
          actualCount: actualCount,
          foundFrames: foundFrames,
          result: passed ? 'pass' : 'fail',
        }],
        scope: 'whole-page-all-frames',
        searchMethod: 'checkTextVisibilityInAllFrames',
      };

      console.log('Validate text in whole page:', payload);
      response.addResult(JSON.stringify(payload, null, 2));
    });
  },
});
//
const validate_element_in_whole_page = defineTabTool({
  capability: 'core',
  schema: {
    name: 'validate_element_in_whole_page',
    title: 'Validate element in whole page',
    description: 'Validate that element with specific role and accessible name exists or does not exist anywhere on the page. Use matchType "exist" to verify element exists exactly once, or "not-exist" to verify element does not exist.',
    inputSchema: validateElementInWholePageSchema,
    type: 'readOnly',
  },
  handle: async (tab, params, response) => {
    const { element, role, accessibleName, matchType } = validateElementInWholePageSchema.parse(params);

    await tab.waitForCompletion(async () => {
      // Get locator for whole page and generate locator string
      const locatorString = 'page.locator("body")'

      // Helper function to create evidence command
      const createEvidenceCommand = () => JSON.stringify({
        description: "Evidence showing how validation was performed",
        toolName: 'validate_element_in_whole_page',
        locator: locatorString,
        arguments: {
          role,
          accessibleName,
          matchType
        }
      });

      let passed = false;
      let evidenceMessage = '';
      let actualCount = 0;
      let foundFrames: string[] = [];

      try {
        // Use checkElementVisibilityUnique to search across all frames
        const results = await checkElementVisibilityUnique(tab.page, role, accessibleName);

        // Count found results
        const foundResults = results.filter(result => result.found);
        actualCount = foundResults.length;
        foundFrames = foundResults.map(result => result.frame);

        // Determine if test passes based on matchType
        if (matchType === 'exist') {
          if (actualCount === 1) {
            passed = true;
            evidenceMessage = `The element "${element}" was found once on the page using ${matchType} matching in frame: ${foundFrames[0]}.`;
          } else if (actualCount > 1) {
            passed = false;
            evidenceMessage = `The element "${element}" appeared ${actualCount} times on the page using ${matchType} matching in frames: ${foundFrames.join(', ')}. Expected only one occurrence.`;
          } else {
            passed = false;
            evidenceMessage = `The element "${element}" was not found on the page using ${matchType} matching.`;
          }
        } else { // not-exist
          if (actualCount === 0) {
            passed = true;
            evidenceMessage = `The element "${element}" was correctly not found on the page using ${matchType} matching.`;
          } else {
            passed = false;
            evidenceMessage = `The element "${element}" was found ${actualCount} time(s) on the page using ${matchType} matching in frames: ${foundFrames.join(', ')} — it should not appear.`;
          }
        }

      } catch (error) {
        passed = false;
        const errorMessage = error instanceof Error ? error.message : String(error);
        evidenceMessage = `Failed to find element "${element}" on the page.`;

        console.log(`Failed to validate element in whole page for "${element}". Error: ${errorMessage}`);
      }

      // Generate evidence as array with single object
      const evidence = [{
        command: createEvidenceCommand(),
        message: evidenceMessage
      }];

      // Generate final payload
      const payload = {
        element,
        role,
        accessibleName,
        matchType,
        summary: {
          total: 1,
          passed: passed ? 1 : 0,
          failed: passed ? 0 : 1,
          status: passed ? 'pass' : 'fail',
          evidence,
        },
        checks: [{
          property: 'element-presence',
          operator: matchType,
          expected: matchType === 'not-exist' ? 'not-present' : 'present-once',
          actual: actualCount > 0 ? `present-${actualCount}-times` : 'not-present',
          actualCount: actualCount,
          foundFrames: foundFrames,
          result: passed ? 'pass' : 'fail',
        }],
        scope: 'whole-page-all-frames',
        searchMethod: 'checkElementVisibilityUnique',
      };

      console.log('Validate element in whole page:', payload);
      response.addResult(JSON.stringify(payload, null, 2));
    });
  },
});

// const validate_expanded = defineTabTool({
//   capability: 'core',
//   schema: {
//     name: 'validate_expanded',
//     title: 'Validate aria-expanded attribute',
//     description: 'Validate that element has the correct aria-expanded attribute value (true or false). If not found on target element, searches in siblings, parent, and children elements.',
//     inputSchema: validateExpandedSchema,
//     type: 'readOnly',
//   },
//   handle: async (tab, params, response) => {
//     const { ref, element, expected } = validateExpandedSchema.parse(params);

//     await tab.waitForCompletion(async () => {
//       let passed = false;
//       let evidence = '';
//       let actualValue = '';
//       let searchLocation = 'target-element';

//       try {
//         const locator = await tab.refLocator({ ref, element });

//         // First, try to validate aria-expanded on the target element
//         await expect(locator).toHaveAttribute('aria-expanded', expected);
//         passed = true;
//         actualValue = expected;
//         evidence = `Element "${element}" has aria-expanded="${expected}" as expected`;
//         searchLocation = 'target-element';

//       } catch (error) {
        
//         // If target element doesn't have the attribute, search in related elements
//         try {
//           const locator = await tab.refLocator({ ref, element });

//           // Search function to find aria-expanded in related elements (excluding target)
//           const searchResult = await locator.evaluate((el: Element, expectedValue: string) => {
//             const results: { location: string; value: string; element: string }[] = [];

//             // Helper function to get element description
//             const getElementDesc = (element: Element): string => {
//               if (element.id) return `#${element.id}`;
//               if (element.className) return `.${element.className.split(' ').join('.')}`;
//               return element.tagName.toLowerCase();
//             };

//             // Check siblings (same level elements)
//             if (el.parentElement) {
//               const siblings = Array.from(el.parentElement.children);
//               siblings.forEach((sibling, index) => {
//                 if (sibling !== el) {
//                   const siblingValue = sibling.getAttribute('aria-expanded');
//                   if (siblingValue !== null) {
//                     results.push({
//                       location: `sibling-${index}`,
//                       value: siblingValue,
//                       element: getElementDesc(sibling)
//                     });
//                   }
//                 }
//               });
//             }

//             // Check parent element
//             if (el.parentElement) {
//               const parentValue = el.parentElement.getAttribute('aria-expanded');
//               if (parentValue !== null) {
//                 results.push({
//                   location: 'parent',
//                   value: parentValue,
//                   element: getElementDesc(el.parentElement)
//                 });
//               }
//             }

//             // Check children elements
//             const children = Array.from(el.children);
//             children.forEach((child, index) => {
//               const childValue = child.getAttribute('aria-expanded');
//               if (childValue !== null) {
//                 results.push({
//                   location: `child-${index}`,
//                   value: childValue,
//                   element: getElementDesc(child)
//                 });
//               }
//             });

//             return results;
//           }, expected);

//           console.log('Search results for aria-expanded in related elements:', searchResult);

//           // If we found any aria-expanded attributes in related elements, validation should fail
//           // but we need to report where they were found
//           if (searchResult.length > 0) {
//             passed = false;
//             actualValue = 'not-on-target-element';
//             searchLocation = 'related-elements';

//             const foundValues = searchResult.map(r => `${r.location}(${r.element}): "${r.value}"`).join(', ');
//             evidence = `Element "${element}" does not have aria-expanded="${expected}" on itself, but found aria-expanded attributes in nearby UI elements: ` +
//               `Alternative validation suggestions: You can validate the element's state using className (e.g., check for 'expanded', 'collapsed', 'open', 'closed' classes), ` +
//               `CSS properties (e.g., display, visibility, height), or other ARIA attributes (e.g., aria-hidden, aria-selected). `;
//           } else {
//             passed = false;
//             actualValue = 'not-found';
//             searchLocation = 'none';
//             evidence = `Element "${element}" does not have aria-expanded="${expected}" and no aria-expanded attributes found in related elements (siblings, parent, children). ` +
//               `Alternative validation suggestions: You can validate the element's state using className (e.g., check for 'expanded', 'collapsed', 'open', 'closed' classes), ` +
//               `CSS properties (e.g., display, visibility, height), or other ARIA attributes (e.g., aria-hidden, aria-selected). `;
//           }

//         } catch (searchError) {
//           passed = false;
//           const errorMessage = searchError instanceof Error ? searchError.message : String(searchError);
//           actualValue = 'search-failed';
//           searchLocation = 'error';
//           evidence = `Failed to search for aria-expanded attribute in related elements.` +
//             `Alternative validation suggestions: You can validate the element's state using className (e.g., check for 'expanded', 'collapsed', 'open', 'closed' classes), ` +
//             `CSS properties (e.g., display, visibility, height), or other ARIA attributes (e.g., aria-hidden, aria-selected). ` ;

//           console.log(`Failed to search aria-expanded for element with ref "${ref}". Error: ${errorMessage}`);
//         }
//       }

//       // Generate final payload
//       const payload = {
//         ref,
//         element,
//         summary: {
//           total: 1,
//           passed: passed ? 1 : 0,
//           failed: passed ? 0 : 1,
//           status: passed ? 'pass' : 'fail',
//           evidence,
//         },
//         checks: [{
//           property: 'aria-expanded',
//           operator: 'equals',
//           expected: expected,
//           actual: actualValue,
//           result: passed ? 'pass' : 'fail',
//         }],
//         scope: 'element-with-relations',
//         attribute: 'aria-expanded',
//         searchLocation: searchLocation,
//       };

//       console.log('Validate expanded:', payload);
//       response.addResult(JSON.stringify(payload, null, 2));
//     });
//   },
// });

const data_extraction = defineTabTool({
  capability: 'core',
  schema: {
    name: 'data_extraction',
    title: 'Data Extraction',
    description: 'Extract and store  value from data object using JSON path with $$ prefix for variable naming. If jsonPath is not provided, stores the data as is without JSON parsing',
    inputSchema: dataExtractionSchema,
    type: 'readOnly',
  },
  handle: async (tab, params, response) => {
    const { name, data, jsonPath } = dataExtractionSchema.parse(params);

    let extractedValue;
    let parsedResponseData;

    if (jsonPath) {
      // If jsonPath is provided, parse as JSON and extract using path
      try {
        parsedResponseData = JSON.parse(data);
      } catch (error) {
        response.addResult(JSON.stringify({
          success: false,
          error: `Failed to parse data as JSON: ${error.message}`,
          extractedData: null
        }, null, 2));
        return;
      }

      try {
        const normalizedPath = jsonPath.startsWith('$') ? jsonPath : `$.${jsonPath}`;
        const queryResult = jp.query(parsedResponseData, normalizedPath);
        extractedValue = queryResult.length === 0 ? null : queryResult.length === 1 ? queryResult[0] : queryResult;
      } catch (error) {
        response.addResult(JSON.stringify({
          success: false,
          error: `Failed to extract value using JSON path "${jsonPath}": ${error.message}`,
          extractedData: null
        }, null, 2));
        return;
      }
    } else {
      // If jsonPath is not provided, return data as is
      extractedValue = data;
      parsedResponseData = data;
    }

    const toolResult = {
      success: true,
      extractedData: {
        value: extractedValue,
        variableName: `\$\{${name}\}`,
      },
      data: parsedResponseData,
    };
    response.addResult(JSON.stringify(toolResult, null, 2));
  },
});





const waitSchema = z.object({
  seconds: z.number().positive().describe('Duration to wait in seconds'),
});

const wait = defineTabTool({
  capability: 'core',
  schema: {
    name: 'wait',
    title: 'Wait',
    description: 'Wait for a specified duration in seconds',
    inputSchema: waitSchema,
    type: 'readOnly',
  },
  handle: async (tab, params, response) => {
    const { seconds } = waitSchema.parse(params);

    await tab.waitForCompletion(async () => {
      await new Promise(resolve => setTimeout(resolve, seconds * 1000));
      response.addResult(`Waited for ${seconds} second(s)`);
    });
  },
});

const validateElementPositionSchema = z.object({
  elements: z.array(z.object({
    element: z.string().describe('Human-readable description of the element used to obtain permission to interact with the element'),
    ref: z.string().describe('Exact target element reference from the page snapshot'),
  })).min(2).max(2).describe('Array of exactly two elements to compare position. First element is element1, second is element2'),
  relationship: z.enum(['left', 'right', 'up', 'down']).describe('Expected positional relationship: "left" means elements[0] is to the left of elements[1], "right" means elements[0] is to the right of elements[1], "up" means elements[0] is above elements[1], "down" means elements[0] is below elements[1]'),
});

const validate_element_position = defineTabTool({
  capability: 'core',
  schema: {
    name: 'validate_element_position',
    title: 'Validate element position relative to another element',
    description: 'Validate the positional relationship between two elements by comparing their bounding boxes. Checks if element1 is left, right, up, or down relative to element2.',
    inputSchema: validateElementPositionSchema,
    type: 'readOnly',
  },
  handle: async (tab, params, response) => {
    const { elements, relationship } = validateElementPositionSchema.parse(params);
    const element1 = elements[0].element;
    const ref1 = elements[0].ref;
    const element2 = elements[1].element;
    const ref2 = elements[1].ref;

    await tab.waitForCompletion(async () => {
      let passed = false;
      let evidence = '';
      let actualRelationship = '';
      let horizontalDiff = 0;
      let verticalDiff = 0;
      let center1 = { x: 0, y: 0 };
      let center2 = { x: 0, y: 0 };
      let locatorString1 = '';
      let locatorString2 = '';

      try {
        const locator1 = await tab.refLocator({ ref: ref1, element: element1 });
        const locator2 = await tab.refLocator({ ref: ref2, element: element2 });

        // Helper function to generate payload when element is not found
        const generateElementNotFoundPayload = async (
          missingElement: string,
          missingRef: string,
          missingLocator: any,
          otherElement: string,
          otherRef: string,
          otherLocator: any
        ) => {
          // Generate locator strings for both elements
          const locatorString1 = await generateLocatorString(missingRef, missingLocator);
          const locatorString2 = await generateLocatorString(otherRef, otherLocator);
         
          const evidenceArray = [{
            command: JSON.stringify({
              toolName: 'validate_element_position',
              locators: [
                {
                  element: missingElement,
                  locatorString: locatorString1
                },
                {
                  element: otherElement,
                  locatorString: locatorString2
                }
              ],
              arguments: {
                relationship: relationship
              }
            }),
            message: `The UI Element "${missingElement}" not found`
          }];

          return {
            element1,
            ref1,
            element2,
            ref2,
            relationship,
            summary: {
              total: 1,
              passed: 0,
              failed: 1,
              status: 'fail',
              evidence: evidenceArray,
            },
            checks: [{
              property: 'position-relationship',
              operator: 'equals',
              expected: relationship,
              actual: 'unknown',
              result: 'fail',
            }],
            scope: 'two-elements',
            comparisonMethod: 'bounding-box-centers',
          };
        };

        // Check if both elements are attached to DOM with timeout
        try {
          await expect(locator1).toBeAttached({ timeout: ELEMENT_ATTACHED_TIMEOUT });
        } catch (error) {
          // Element1 not found, generate payload and return early
          const payload = await generateElementNotFoundPayload(element1, ref1, locator1, element2, ref2, locator2);
          console.log('Validate element position - UI element not found:', payload);
          response.addResult(JSON.stringify(payload, null, 2));
          return;
        }

        try {
          await expect(locator2).toBeAttached({ timeout: ELEMENT_ATTACHED_TIMEOUT });
        } catch (error) {
          // Element2 not found, generate payload and return early
          const payload = await generateElementNotFoundPayload(element2, ref2, locator2, element1, ref1, locator1);
          console.log('Validate element position - UI element not found:', payload);
          response.addResult(JSON.stringify(payload, null, 2));
          return;
        }

        // Generate locator strings after both elements are confirmed to be attached
        locatorString1 = await generateLocatorString(ref1, locator1);
        locatorString2 = await generateLocatorString(ref2, locator2);

        // Get bounding boxes for both elements
        const box1 = await locator1.boundingBox();
        const box2 = await locator2.boundingBox();

        if (!box1) {
          throw new Error(`Could not get bounding box for element1: "${element1}"`);
        }
        if (!box2) {
          throw new Error(`Could not get bounding box for element2: "${element2}"`);
        }

        // Calculate center points for more accurate comparison
        center1 = {
          x: box1.x + box1.width / 2,
          y: box1.y + box1.height / 2,
        };
        center2 = {
          x: box2.x + box2.width / 2,
          y: box2.y + box2.height / 2,
        };

        // Determine actual relationship
        horizontalDiff = center1.x - center2.x;
        verticalDiff = center1.y - center2.y;

        // Determine relationships
        const isLeft = horizontalDiff < 0;
        const isRight = horizontalDiff > 0;
        const isUp = verticalDiff < 0;
        const isDown = verticalDiff > 0;

        // Build actual relationship description
        const relationships: string[] = [];
        if (isLeft) relationships.push('left');
        if (isRight) relationships.push('right');
        if (isUp) relationships.push('up');
        if (isDown) relationships.push('down');

        actualRelationship = relationships.length > 0 ? relationships.join(', ') : 'overlapping';

        // Validate based on expected relationship
        switch (relationship) {
          case 'left':
            passed = isLeft && !isRight;
            break;
          case 'right':
            passed = isRight && !isLeft;
            break;
          case 'up':
            passed = isUp && !isDown;
            break;
          case 'down':
            passed = isDown && !isUp;
            break;
        }

        // Generate evidence message
        if (passed) {
          evidence = `Element "${element1}" is ${relationship} relative to element "${element2}" as expected. ` +
            `Actual relationship: ${actualRelationship}. ` +
            `Horizontal difference: ${Math.round(horizontalDiff)}px, Vertical difference: ${Math.round(verticalDiff)}px.`;
        } else {
          evidence = `Element "${element1}" is NOT ${relationship} relative to element "${element2}". ` +
            `Expected: ${relationship}, Actual: ${actualRelationship}. ` +
            `Horizontal difference: ${Math.round(horizontalDiff)}px, Vertical difference: ${Math.round(verticalDiff)}px. ` +
            `Element1 center: (${Math.round(center1.x)}, ${Math.round(center1.y)}), ` +
            `Element2 center: (${Math.round(center2.x)}, ${Math.round(center2.y)}).`;
        }

      } catch (error) {
        passed = false;
        const errorMessage = error instanceof Error ? error.message : String(error);
        evidence = `Failed to validate element position: ${errorMessage}`;

        console.error(`Failed to validate element position for "${element1}" and "${element2}". Error: ${errorMessage}`);

        // Generate locator strings for error case (try to generate even if execution failed)
        try {
          const locator1 = await tab.refLocator({ ref: ref1, element: element1 });
          locatorString1 = await generateLocatorString(ref1, locator1);
        } catch {
          locatorString1 = 'The UI Element not found';
        }

        try {
          const locator2 = await tab.refLocator({ ref: ref2, element: element2 });
          locatorString2 = await generateLocatorString(ref2, locator2);
        } catch {
          locatorString2 = 'The UI Element not found';
        }
      }

      // Generate evidence as array of objects with command and message
      const evidenceArray = [{
        command: JSON.stringify({
          toolName: 'validate_element_position',
          locators: [
            {
              element: element1,
              locatorString: locatorString1
            },
            {
              element: element2,
              locatorString: locatorString2
            }
          ],
          arguments: {
            relationship: relationship
          }
        }),
        message: evidence
      }];

      // Generate final payload matching the structure of other validation tools
      const payload = {
        element1,
        ref1,
        element2,
        ref2,
        relationship,
        summary: {
          total: 1,
          passed: passed ? 1 : 0,
          failed: passed ? 0 : 1,
          status: passed ? 'pass' : 'fail',
          evidence: evidenceArray,
        },
        checks: [{
          property: 'position-relationship',
          operator: 'equals',
          expected: relationship,
          actual: actualRelationship || 'unknown',
          result: passed ? 'pass' : 'fail',
          horizontalDifference: Math.round(horizontalDiff),
          verticalDifference: Math.round(verticalDiff),
          element1Center: { x: Math.round(center1.x), y: Math.round(center1.y) },
          element2Center: { x: Math.round(center2.x), y: Math.round(center2.y) },
        }],
        scope: 'two-elements',
        comparisonMethod: 'bounding-box-centers',
      };

      console.log('Validate element position:', payload);
      response.addResult(JSON.stringify(payload, null, 2));
    });
  },
});

const validateElementOrderSchema = z.object({
  elements: z.array(z.object({
    element: z.string().describe('Human-readable description of the element used to obtain permission to interact with the element'),
    ref: z.string().describe('Exact target element reference from the page snapshot for the element'),
  })).min(2).describe('Array of elements to validate order for (minimum 2 elements required). Elements should be provided in the expected visual order.'),
});

const validate_element_order = defineTabTool({
  capability: 'core',
  schema: {
    name: 'validate_element_order',
    title: 'Validate order of multiple elements',
    description: 'Validate that multiple elements appear in the expected visual order using natural reading order (top-to-bottom, then left-to-right). Only checks order, not exact positions.',
    inputSchema: validateElementOrderSchema,
    type: 'readOnly',
  },
  handle: async (tab, params, response) => {
    const { elements } = validateElementOrderSchema.parse(params);

    await tab.waitForCompletion(async () => {
      let passed = false;
      let evidenceMessage = '';
      const checks: any[] = [];
      const elementCenters: Array<{ element: string; x: number; y: number }> = [];
      const locators: Array<{ element: string; locatorString: string }> = [];

      try {
        if (elements.length < 2) {
          throw new Error('At least 2 elements are required to validate order');
        }

        // Helper function to generate payload when element is not found
        const generateElementNotFoundPayload = async (missingElement: string) => {
          // Generate locator strings for all elements
          const allLocators: Array<{ element: string; locatorString: string }> = [];
          for (const { element, ref } of elements) {
            try {
              const locator = await tab.refLocator({ ref, element });
              const locatorString = await generateLocatorString(ref, locator);
              allLocators.push({ element, locatorString });
            } catch {
              allLocators.push({ element, locatorString: 'The UI Element not found' });
            }
          }

          const evidence = [{
            command: JSON.stringify({
              toolName: 'validate_element_order',
              arguments: {
                elements: elements.map(e => ({ element: e.element, ref: e.ref }))
              },
              locators: allLocators
            }),
            message: `The UI Element "${missingElement}" not found`
          }];

          return {
            elements: elements.map(e => ({ element: e.element, ref: e.ref })),
            summary: {
              total: elements.length,
              passed: 0,
              failed: elements.length,
              status: 'fail' as const,
              evidence,
            },
            checks: [],
            elementCenters: [],
            scope: 'multiple-elements',
            comparisonMethod: 'reading-order',
          };
        };

        // Get locators for all elements and check if they are attached
        const elementLocators: Array<{ element: string; ref: string; locator: any }> = [];
        for (const { element, ref } of elements) {
          const locator = await tab.refLocator({ ref, element });
          elementLocators.push({ element, ref, locator });
        }

        // Check if all elements are attached to DOM with timeout
        for (const { element, ref, locator } of elementLocators) {
          try {
            await expect(locator).toBeAttached({ timeout: ELEMENT_ATTACHED_TIMEOUT });
          } catch (error) {
            // Element not found, generate payload and return early
            const payload = await generateElementNotFoundPayload(element);
            console.log('Validate element order - UI element not found:', payload);
            response.addResult(JSON.stringify(payload, null, 2));
            return;
          }
        }

        // Generate locator strings after all elements are confirmed to be attached
        for (const { element, ref, locator } of elementLocators) {
          const locatorString = await generateLocatorString(ref, locator);
          locators.push({ element, locatorString });
        }

        // Get bounding boxes for all elements
        const boxes: Array<{ element: string; ref: string; box: { x: number; y: number; width: number; height: number } | null }> = [];
        for (const { element, ref, locator } of elementLocators) {
          const box = await locator.boundingBox();
          boxes.push({ element, ref, box });
          
          if (!box) {
            throw new Error(`Could not get bounding box for element: "${element}"`);
          }
        }

        // Calculate center points for all elements
        const elementData: Array<{ element: string; ref: string; x: number; y: number; index: number }> = [];
        for (let i = 0; i < boxes.length; i++) {
          const { element, ref, box } = boxes[i];
          if (box) {
            const center = {
              x: box.x + box.width / 2,
              y: box.y + box.height / 2,
            };
            elementData.push({ element, ref, ...center, index: i });
            elementCenters.push({ element, ...center });
          }
        }

        // Helper function to compare elements by reading order (top-to-bottom, then left-to-right)
        // Returns: -1 if a comes before b, 1 if a comes after b, 0 if same position
        const compareReadingOrder = (a: { y: number; x: number }, b: { y: number; x: number }): number => {
          // First compare by y (top-to-bottom)
          const yDiff = a.y - b.y;
          // Use a threshold to account for elements on the same "row" (within 10px)
          const rowThreshold = 10;
          if (Math.abs(yDiff) > rowThreshold) {
            return yDiff;
          }
          // If roughly on the same row, compare by x (left-to-right)
          return a.x - b.x;
        };

        // Validate order: check that each element comes before the next one in reading order
        let allInOrder = true;
        const orderIssues: string[] = [];

        for (let i = 0; i < elementData.length - 1; i++) {
          const current = elementData[i];
          const next = elementData[i + 1];
          const comparison = compareReadingOrder(current, next);
          const isInOrder = comparison <= 0;
          
          const currentPos = `(x: ${Math.round(current.x)}, y: ${Math.round(current.y)})`;
          const nextPos = `(x: ${Math.round(next.x)}, y: ${Math.round(next.y)})`;
          
          checks.push({
            property: 'reading-order',
            operator: 'before-or-equal',
            expected: `Element "${current.element}" should come before or at same position as "${next.element}" in reading order`,
            actual: isInOrder ? 'in order' : 'out of order',
            result: isInOrder ? 'pass' : 'fail',
            currentElement: current.element,
            nextElement: next.element,
            currentPosition: currentPos,
            nextPosition: nextPos,
            comparison: comparison,
          });

          if (!isInOrder) {
            allInOrder = false;
            orderIssues.push(`"${current.element}" ${currentPos} comes after "${next.element}" ${nextPos} in reading order`);
          }
        }

        passed = allInOrder;

        // Generate evidence message
        const elementNames = elements.map(e => `"${e.element}"`).join(', ');
        if (passed) {
          evidenceMessage = `All elements are in correct reading order (top-to-bottom, then left-to-right): ${elementNames}. ` +
            `Total elements validated: ${elements.length}.`;
        } else {
          evidenceMessage = `Elements are NOT in correct reading order. ` +
            `Expected order: ${elementNames}. ` +
            `Order issues: ${orderIssues.join('; ')}.`;
        }

      } catch (error) {
        passed = false;
        const errorMessage = error instanceof Error ? error.message : String(error);
        evidenceMessage = `Failed to validate element order: ${errorMessage}`;

        console.error(`Failed to validate element order. Error: ${errorMessage}`);
      }

      // Generate evidence as array of objects with command and message
      const evidence = [{
        command: JSON.stringify({
          toolName: 'validate_element_order',
          arguments: {
            elements: elements.map(e => ({ element: e.element, ref: e.ref }))
          },
          locators: locators
        }),
        message: evidenceMessage
      }];

      // Generate final payload matching the structure of other validation tools
      const payload = {
        elements: elements.map(e => ({ element: e.element, ref: e.ref })),
        summary: {
          total: elements.length,
          passed: passed ? elements.length : 0,
          failed: passed ? 0 : elements.length,
          status: passed ? 'pass' : 'fail',
          evidence,
        },
        checks,
        elementCenters: elementCenters.map(ec => ({
          element: ec.element,
          x: Math.round(ec.x),
          y: Math.round(ec.y),
        })),
        scope: 'multiple-elements',
        comparisonMethod: 'reading-order',
      };

      console.log('Validate element order:', payload);
      response.addResult(JSON.stringify(payload, null, 2));
    });
  },
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

const dynamic_switch = defineTabTool({
  capability: 'core',
  schema: {
    name: 'dynamic_switch',
    title: 'Dynamic Switch',
    description: 'Select which tool to run based on flag value matching switch-cases. The flagName parameter contains the actual value to match against cases. Returns the chosen tool and params; can be used by the orchestrator to invoke the tool.',
    inputSchema: dynamicSwitchSchema,
    type: 'readOnly',
  },
  handle: async (tab, rawParams, response) => {
    const { flagName, cases, defaultCase } = dynamicSwitchSchema.parse(rawParams);

    // Use flagName as the actual value (agent will replace flagName with actual value)
    const flagValue = flagName;

    // Find first matching case
    let matchedIndex = -1;
    let chosenTool: { toolName: string; params?: any; readyForCaching?: boolean } | null = null;

    for (let i = 0; i < cases.length; i++) {
      const c = cases[i];
      if (flagValue === c.equals) {
        matchedIndex = i;
        chosenTool = { toolName: c.toolName, params: c.params, readyForCaching: c.readyForCaching };
        break;
      }
    }

    // Use default case if no match found
    if (matchedIndex === -1 && defaultCase) {
      chosenTool = { toolName: defaultCase.toolName, params: defaultCase.params, readyForCaching: defaultCase.readyForCaching };
    }

    const payload = {
      flagName,
      flagValue,
      matchedCaseIndex: matchedIndex,
      selected: chosenTool,
      summary: {
        total: 1,
        passed: chosenTool ? 1 : 0,
        failed: chosenTool ? 0 : 1,
        status: chosenTool ? 'pass' : 'fail',
        evidence: chosenTool ? `Selected tool "${chosenTool.toolName}" for flag value "${flagValue}"` : `No case matched for flag value "${flagValue}" and no defaultCase provided`
      },
      actions: chosenTool && chosenTool.readyForCaching ? [{ type: 'invoke_tool', toolName: chosenTool.toolName, params: chosenTool.params }] : []
    };

    response.addResult(JSON.stringify(payload, null, 2));
  },
});

const custom_wait = defineTool({
  capability: 'core',

  schema: {
    name: 'custom_browser_wait_for',
    title: 'Wait for',
    description: 'Wait for text to appear or disappear with optional maximum timeout',
    inputSchema: z.object({
      time: z.number().optional().describe('Maximum time to wait in seconds for text to appear/disappear. If not provided, default actionTimeout is used'),
      text: z.string().optional().describe('The text to wait for'),
      textGone: z.string().optional().describe('The text to wait for to disappear'),
    }),
    type: 'assertion',
  },

  handle: async (context, params, response) => {
    if (!params.text && !params.textGone && !params.time)
      throw new Error('Either time, text or textGone must be provided');

    const tab = context.currentTabOrDie();
    const actionTimeout = params.time ? params.time * 1000 : context.config.timeouts.action;

    // Helper function to wait for text in all frames asynchronously
    const waitForTextInFrames = async (text: string, state: 'visible' | 'hidden') => {
      // Collect all iframes
      const allFrames = await collectAllFrames(tab.page, 0);

      // Create promise for main frame
      const mainLocator = tab.page.getByText(text).first();
      const mainPromise = mainLocator.waitFor({ state, timeout: actionTimeout })
        .then(() => ({ found: true, frame: 'main' }));

      // Create promises for all iframes with explicit timeout
      const iframePromises = allFrames.map(frameInfo => {
        const frameLocator = frameInfo.frame.getByText(text).first();
        return frameLocator.waitFor({ state, timeout: actionTimeout })
          .then(() => ({ found: true, frame: frameInfo.name }));
      });

      // Wait for first successful result using Promise.race
      const result = await Promise.race([mainPromise, ...iframePromises]);
      return result;
    };

    let foundFrame: string | null = null;

    if (params.textGone) {
      response.addCode(`await page.getByText(${JSON.stringify(params.textGone)}).first().waitFor({ state: 'hidden' });`);
      const result = await waitForTextInFrames(params.textGone, 'hidden');
      foundFrame = result.frame;
    }

    if (params.text) {
      response.addCode(`await page.getByText(${JSON.stringify(params.text)}).first().waitFor({ state: 'visible' });`);
      const result = await waitForTextInFrames(params.text, 'visible');
      foundFrame = result.frame;
    }

    const frameInfo = foundFrame && foundFrame !== 'main' ? ` (found in ${foundFrame})` : '';
    response.addResult(`Waited for ${params.text || params.textGone || params.time}${frameInfo}`);
    response.setIncludeSnapshot();
  },
});


export default [
  extract_svg_from_element,
  extract_image_urls,
  validate_computed_styles,
  validate_text_in_whole_page,
  validate_element_in_whole_page,
  validate_dom_assertions,
  validate_alert_in_snapshot,
  //validate_expanded,
  validate_element_position,
  validate_element_order,
  default_validation,
  validate_response,
  validate_tab_exist,
  generate_locator,
  make_request,
  data_extraction,
  wait,
  dynamic_switch,
  custom_wait
];