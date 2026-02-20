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
import { promisify } from 'util';
import { expect } from '@zealous-tech/playwright/test';
import { execFile } from 'child_process';
import { generateLocator } from '../../utils.js';
import { applyArrayFilter, compareValues, parseCurlStderr, ELEMENT_ATTACHED_TIMEOUT } from './utils.js';
import { ParsedCurlResponse, ValidationPayload, ValidationResult } from '../common/common.js';

async function getAllComputedStylesDirect(
  tab: any,
  ref: string,
  element: string
): Promise<Record<string, string>> {
  const { locator } = await tab.refLocator({ ref, element });

  const allStyles: Record<string, string> = await locator.evaluate(
      (el: Element) => {
        const cs = window.getComputedStyle(el);
        const out: Record<string, string> = {};
        for (let i = 0; i < cs.length; i++) {
          const name = cs[i]; // kebab-case
          out[name] = cs.getPropertyValue(name);
        }
        return out;
      }
  );

  return allStyles;
}

// Function to check if alert dialog is present in snapshot
function hasAlertDialog(snapshotContent: string): boolean {
  // Check for dialog information in the snapshot
  const hasModalState = snapshotContent.includes('### Modal state');
  const hasDialogMessage = snapshotContent.includes('dialog with message');
  const hasNoModalState = snapshotContent.includes('There is no modal state present');

  console.log('hasModalState:', hasModalState);
  console.log('hasDialogMessage:', hasDialogMessage);
  console.log('hasNoModalState:', hasNoModalState);

  return hasModalState && hasDialogMessage && !hasNoModalState;
}

// Function to extract alert dialog text from snapshot
function getAlertDialogText(snapshotContent: string): string | null {
  if (!hasAlertDialog(snapshotContent))
    return null;

  // Look for dialog message pattern: "dialog with message "text""
  const dialogMatch = snapshotContent.match(/dialog with message "([^"]+)"/);
  if (dialogMatch)
    return dialogMatch[1];

  return null;
}

/**
 * Generate locator string from ref and locator
 * If ref starts with ###code, extracts the code directly
 * Otherwise, generates locator string using generateLocator
 */
async function generateLocatorString(ref: string, locator: any, preferCssSelector: boolean = false): Promise<string> {
  const isLocatorCode = ref && ref.startsWith('###code');
  if (isLocatorCode) {
    const locatorCode = ref.match(/###code(.+)/)?.[1]?.trim() || '';
    return locatorCode || '';
  }
  return await generateLocator(locator, preferCssSelector);
}


// Helper function to perform regex-based checks
function performRegexCheck(responseData: string, check: any) {
  try {
    switch (check.type) {
      case 'regex_extract':
        return performRegexExtract(responseData, check);

      case 'regex_match':
        return performRegexMatch(responseData, check);


      default:
        return { passed: false, actual: 'Unknown check type' };
    }
  } catch (error) {
    return { passed: false, actual: `Error: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function performRegexExtract(responseData: string, check: any) {
  const regex = new RegExp(check.pattern, 'i');
  const match = responseData.match(regex);

  if (!match)
    return { passed: false, actual: 'Pattern not found' };


  const extractedValue = match[check.extractGroup || 1];
  if (extractedValue === undefined)
    return { passed: false, actual: `Capture group ${check.extractGroup || 1} not found` };


  // If no expected value, just return success
  if (check.expected === undefined)
    return { passed: true, actual: extractedValue };


  // Compare extracted value with expected
  return compareValues(extractedValue, check.expected, check.operator);
}

function performRegexMatch(responseData: string, check: any) {
  const regex = new RegExp(check.pattern, 'i');
  const isMatch = regex.test(responseData);

  // For regex_match, just return the test result
  return { passed: isMatch, actual: isMatch ? 'Pattern matched' : 'Pattern not matched' };
}

async function runCommand(command: string): Promise<{ stdout: string; stderr: string }> {
  const CURL_PATTERN = /curl```([\s\S]*?)```/i;
  const execFileAsync = promisify(execFile);

  const SHELL_META = /[|&;><`]/;

  const ALLOWED_FLAGS = new Set<string>([
    '-X', '--request',
    '-H', '--header',
    '-I', '--head',
    '-s', '--silent', '--no-progress-meter',
    '--compressed',
    '-L', '--location',
    '--max-time', '--connect-timeout',
    '--http1.1', '--http2',
    '-d', '--data', '--data-raw', '--data-binary', '--data-urlencode',
    '-v', '--verbose',
  ]);

  const FORBIDDEN_FLAGS = new Set<string>([
    '-K', '--config',
    '-o', '--output', '-O', '--remote-name',
    '--write-out', '--dump-header',
    '--trace', '--trace-ascii', '--trace-time',
    '-T', '--upload-file',
    '-u', '--user',
    '--proto', '--proto-redir', '--interface', '--proxy',
    '--help', '--manual'
  ]);

  function tokenize(input: string): string[] {
    const out: string[] = [];
    let cur = '';
    let inToken = false;                  // NEW: tracks whether an arg has started
    let quote: "'" | '"' | null = null;

    for (let i = 0; i < input.length; i++) {
      const c = input[i];

      if (quote) {
        if (c === quote) {                // closing quote — don't flush yet
          quote = null;
        } else if (c === '\\' && quote === '"' && i + 1 < input.length) {
          i++; cur += input[i];           // allow \" inside double quotes
          inToken = true;
        } else {
          cur += c;
          inToken = true;
        }
        continue;
      }

      if (c === "'" || c === '"') {       // opening quote starts a token, even if empty
        quote = c as "'" | '"';
        inToken = true;
        continue;
      }

      if (c === '\\' && i + 1 < input.length) {
        i++; cur += input[i];
        inToken = true;
        continue;
      }

      if (/\s/.test(c)) {                 // on whitespace, flush if a token was started
        if (inToken) { out.push(cur); cur = ''; inToken = false; }
        continue;
      }

      cur += c;
      inToken = true;
    }

    if (quote)
      throw new Error('Unclosed quote in command');
    if (inToken)
      out.push(cur);           // flush final token (even if it's "")
    return out;
  }

  function basicGuard(raw: string) {
    if (SHELL_META.test(raw))
      throw new Error('Shell metacharacters are not allowed.');
    if (raw.length > 20_000)
      throw new Error('Command too long.');
  }

  function validateUrl(raw: string) {
    let u: URL;
    try { u = new URL(raw); } catch { throw new Error(`Invalid URL: ${raw}`); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:')
      throw new Error('Only HTTP/HTTPS URLs are allowed.');

    if (u.username || u.password)
      throw new Error('Credentials in URL are not allowed.');
    if (u.href.length > 4096)
      throw new Error('URL too long.');
  }

  function parseAndValidateCurlArgs(rawCurl: string): string[] {
    basicGuard(rawCurl);
    const tokens = tokenize(rawCurl.trim());
    if (tokens.length === 0)
      throw new Error('Empty curl command');
    if (tokens[0] !== 'curl')
      throw new Error('Only curl is allowed.');

    const args: string[] = [];
    let urlCount = 0;

    for (let i = 1; i < tokens.length; i++) {
      const t = tokens[i];

      if (!t.startsWith('-')) {
        validateUrl(t);
        args.push(t);
        urlCount++;
        continue;
      }

      if (FORBIDDEN_FLAGS.has(t))
        throw new Error(`Flag not allowed: ${t}`);
      if (!ALLOWED_FLAGS.has(t))
        throw new Error(`Unsupported flag: ${t}`);
      args.push(t);

      const expectsValue = new Set([
        '-X', '--request',
        '-H', '--header',
        '--max-time', '--connect-timeout',
        '-d', '--data', '--data-raw', '--data-binary', '--data-urlencode'
      ]);

      if (expectsValue.has(t)) {
        const v = tokens[++i];
        if (v === null)
          throw new Error(`Flag ${t} requires a value`);

        if ((t === '-d' || t.startsWith('--data')) && v.startsWith('@'))
          throw new Error('Reading data from files is not allowed.');

        if ((t === '-H' || t === '--header') && v.length > 8_192)
          throw new Error('Header value too long.');

        args.push(v);
      }
    }

    if (urlCount === 0)
      throw new Error('URL is required.');
    if (urlCount > 1)
      throw new Error('Multiple URLs are not allowed.');
    return args;
  }

  const m = command.match(CURL_PATTERN);
  const rawCurl = m ? `curl ${m[1]}` : command;
  const args = parseAndValidateCurlArgs(rawCurl);

  const { stdout, stderr } = await execFileAsync('curl', args, {
    shell: false,
    windowsHide: true,
    timeout: 15_000,
    maxBuffer: 2 * 1024 * 1024,
    env: { PATH: process.env.PATH },
  });

  return { stdout, stderr };
}

async function runCommandClean(command: string): Promise<ParsedCurlResponse> {
  const { stdout, stderr } = await runCommand(command);
  const parsed = parseCurlStderr(stderr);

  let data = stdout;
  try {
    const jsonData = JSON.parse(stdout);
    data = jsonData;
  } catch (error) {
    console.log('Failed to parse JSON from curl stdout:', error instanceof Error ? error.message : String(error));
  }

  return {
    data,
    statusCode: parsed.statusCode,
    responseTime: parsed.responseTime,
    contentLength: parsed.contentLength,
    contentType: parsed.contentType,
    server: parsed.server,
    connection: parsed.connection,
    date: parsed.date,
    etag: parsed.etag,
    xPoweredBy: parsed.xPoweredBy,
    error: parsed.error,
    // rawStderr: stderr
  };
}

/**
 * Extract value from object using JSONPath-like syntax
 * Supports:
 * - Simple properties: "data.token", "statusCode"
 * - Array indices: "data.books[0].title"
 * - Array filters: "data.books[?(@.isbn=='9781449325862')].title"
 * - Comparison operators: ==, !=, ===, !==, >, <, >=, <=
 * - Boolean values: "data.users[?(@.active==true)]"
 */
function getValueByJsonPath(obj: any, path: string): any {
  if (!path || path === '')
    return obj;
  if (path === null || path === undefined)
    throw new Error(`JSON path is null or undefined`);

  // More sophisticated parsing to handle brackets properly
  const parts: string[] = [];
  let current = '';
  let bracketDepth = 0;

  for (let i = 0; i < path.length; i++) {
    const char = path[i];

    if (char === '[') {
      if (bracketDepth === 0 && current) {
        parts.push(current);
        current = '';
      }
      bracketDepth++;
      current += char;
    } else if (char === ']') {
      bracketDepth--;
      current += char;
      if (bracketDepth === 0) {
        parts.push(current);
        current = '';
      }
    } else if (char === '.' && bracketDepth === 0) {
      if (current) {
        parts.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }

  if (current)
    parts.push(current);


  let currentObj = obj;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];

    if (currentObj === null || currentObj === undefined)
      throw new Error(`Value not found at JSON path "${path}". Path segment "${part}" points to null/undefined value.`);


    // Handle array notation with filters or indices
    if (part.startsWith('[') && part.endsWith(']')) {
      const content = part.slice(1, -1);

      // Handle filter expressions like [?(@.isbn=='9781449325862')]
      if (content.startsWith('?(@')) {
        const filterResult = applyArrayFilter(currentObj, content);
        if (filterResult === undefined)
          throw new Error(`Value not found at JSON path "${path}". Array filter "${content}" did not match any elements.`);

        currentObj = filterResult;
      } else {
        const index = parseInt(content, 10);
        if (isNaN(index) || !Array.isArray(currentObj))
          throw new Error(`Value not found at JSON path "${path}". Expected array at index "${content}" but found ${Array.isArray(currentObj) ? 'array' : typeof currentObj}.`);

        currentObj = currentObj[index];
      }
    } else if (typeof currentObj === 'object' && !Array.isArray(currentObj)) {
      if (!(part in currentObj))
        throw new Error(`Value not found at JSON path "${path}". Property "${part}" does not exist in object.`);
      currentObj = currentObj[part];
    } else {
      throw new Error(`Value not found at JSON path "${path}". Expected object at segment "${part}" but found ${typeof currentObj}.`);
    }
  }

  return currentObj;
}

/**
 * Check element visibility with parallel recursive search across all frames
 * Ensures exactly 1 element is found with the specified role and accessibleName
 */
async function checkElementVisibilityUnique(page: any, role: string, accessibleName: string) {

  const searchPromises = [];

  // Add search in main frame
  searchPromises.push(
      expect(page.getByRole(role, { name: accessibleName })).toBeVisible()
          .then(() => ({ found: true, frame: 'main', level: 0 }))
          .catch(() => ({ found: false, frame: 'main', level: 0 }))
  );

  // Recursively collect all iframes at all levels
  const allFrames = await collectAllFrames(page, 0);

  // Create promises for all frames
  for (const frameInfo of allFrames) {
    searchPromises.push(
        expect(frameInfo.frame.getByRole(role, { name: accessibleName })).toBeVisible({ timeout: 2000 })
            .then(() => ({ found: true, frame: frameInfo.name, level: frameInfo.level }))
            .catch(() => ({ found: false, frame: frameInfo.name, level: frameInfo.level }))
    );
  }

  // Wait for all search results in parallel
  const results = await Promise.all(searchPromises);

  return results;
}

/**
 * Check text visibility with parallel recursive search across all frames
 * Returns all search results without counting logic
 * Uses expect with timeout for autowait functionality
 * Optimized: waits for first successful result from any frame and returns immediately
 */
async function checkTextExistenceInAllFrames(page: any, text: string, matchType: 'exact' | 'contains' | 'not-contains' = 'contains', timeout: number = ELEMENT_ATTACHED_TIMEOUT) {
  const searchPromises: Promise<{ found: boolean; count: number; frame: string; level: number }>[] = [];

  const mainLocator =
    matchType === 'exact'
      ? page.getByText(text, { exact: true })
      : page.getByText(text);

  // Create promise for main frame
  if (matchType === 'not-contains') {
    searchPromises.push(
        expect(mainLocator).toHaveCount(0, { timeout })
            .then(() => ({ found: false, count: 0, frame: 'main', level: 0 }))
            .catch(async () => {
              const count = await mainLocator.count();
              return { found: true, count, frame: 'main', level: 0 };
            })
    );
  } else {
    searchPromises.push(
        expect(mainLocator.first()).toBeVisible({ timeout })
            .then(async () => {
              const count = await mainLocator.count();
              return { found: true, count, frame: 'main', level: 0 };
            })
            .catch(async () => {
              const count = await mainLocator.count();
              return { found: false, count, frame: 'main', level: 0 };
            })
    );
  }

  // Collect all frames and create promises for each
  const allFrames = await collectAllFrames(page, 0);

  for (const frameInfo of allFrames) {
    const frameLocator =
      matchType === 'exact'
        ? frameInfo.frame.getByText(text, { exact: true })
        : frameInfo.frame.getByText(text);

    if (matchType === 'not-contains') {
      searchPromises.push(
          expect(frameLocator).toHaveCount(0, { timeout })
              .then(() => ({ found: false, count: 0, frame: frameInfo.name, level: frameInfo.level }))
              .catch(async () => {
                const count = await frameLocator.count();
                return { found: true, count, frame: frameInfo.name, level: frameInfo.level };
              })
      );
    } else {
      searchPromises.push(
          expect(frameLocator.first()).toBeVisible({ timeout })
              .then(async () => {
                const count = await frameLocator.count();
                return { found: true, count, frame: frameInfo.name, level: frameInfo.level };
              })
              .catch(async () => {
                const count = await frameLocator.count();
                return { found: false, count, frame: frameInfo.name, level: frameInfo.level };
              })
      );
    }
  }

  // Wait for first successful result from any frame
  // For contains/exact: success = found === true (text found)
  // For not-contains: success = found === true (text found when it shouldn't be)
  const successCondition = (result: { found: boolean }) => result.found === true;

  // Wrap promises to track first success
  let firstSuccess: { found: boolean; count: number; frame: string; level: number } | null = null;
  let successResolve: ((value: { found: boolean; count: number; frame: string; level: number }) => void) | null = null;
  
  const successPromise = new Promise<{ found: boolean; count: number; frame: string; level: number }>((resolve) => {
    successResolve = resolve;
  });

  // Monitor all promises for first success
  const monitoredPromises = searchPromises.map(promise => 
    promise.then(result => {
      if (successCondition(result) && successResolve && !firstSuccess) {
        firstSuccess = result;
        successResolve(result);
      }
      return result;
    })
  );

  // Race between first success and all promises
  try {
    const result = await Promise.race([
      successPromise,
      Promise.all(monitoredPromises).then(results => {
        // Check if any result is successful
        const successfulResult = results.find(successCondition);
        return successfulResult || null;
      })
    ]);

    if (result) {
      return [result];
    }
  } catch (error) {
    // Fall through
  }

  // If no successful result found, return all results
  const allResults = await Promise.all(searchPromises);
  return allResults;
}

/**
 * Recursively collect all frames (main + all iframes at all levels)
 */
async function collectAllFrames(page: any, level: number): Promise<Array<{frame: any, name: string, level: number}>> {
  const frames = [];
  const iframes = page.locator('iframe');
  const iframeCount = await iframes.count();

  for (let i = 0; i < iframeCount; i++) {
    const iframe = page.frameLocator(`iframe >> nth=${i}`);
    const frameName = `iframe-${level}-${i}`;

    frames.push({ frame: iframe, name: frameName, level });

    // Recursively collect nested iframes
    try {
      const nestedFrames = await collectAllFrames(iframe, level + 1);
      frames.push(...nestedFrames);
    } catch (error) {
      // Ignore errors when accessing nested frames
      continue;
    }
  }

  return frames;
}

// Function to generate evidence for assertions
function getAssertionEvidence(
  assertionType: string,
  negate: boolean,
  locatorString: string,
  elementDescription: string,
  mainArgs?: any,
  options?: any,
): string {
  // Messages for passed assertions
  const passedEvidenceMessages: Record<string, (args?: any, opts?: any) => string> = {
    toBeEnabled: (args, opts) => {
      // Check if options.enabled is explicitly set to false
      const enabledValue = opts?.enabled;
      if (enabledValue === false) {
        // If enabled: false, we're checking that element is disabled
        return `'${elementDescription}' is ${negate ? 'enabled' : 'disabled'} `;
      } else {
        // Default: checking that element is enabled
        return `'${elementDescription}' is ${negate ? 'disabled' : 'enabled'} `;
      }
    },
    toBeDisabled: () => `'${elementDescription}' is ${negate ? 'enabled' : 'disabled'} `,
    toBeVisible: (args, opts) => {
      // Check if options.visible is explicitly set to false
      const visibleValue = opts?.visible;
      if (visibleValue === false) {
        // If visible: false, we're checking that element is hidden
        return `'${elementDescription}' is ${negate ? 'visible' : 'hidden'} `;
      } else {
        // Default: checking that element is visible
        return `'${elementDescription}' is ${negate ? 'hidden' : 'visible'} `;
      }
    },
    toBeHidden: () => `'${elementDescription}' is ${negate ? 'visible' : 'hidden'} `,
    toBeInViewport: () => `'${elementDescription}' is ${negate ? 'outside viewport' : 'in viewport'} `,
    toBeChecked: (args, opts) => {
      // Check if options.checked is explicitly set to false
      const checkedValue = opts?.checked;
      if (checkedValue === false) {
        // If checked: false, we're checking that element is unchecked
        return `'${elementDescription}' is ${negate ? 'checked' : 'unchecked'} `;
      } else {
        // Default: checking that element is checked
        return `'${elementDescription}' is ${negate ? 'unchecked' : 'checked'} `;
      }
    },
    toBeFocused: () => `'${elementDescription}' is ${negate ? 'not focused' : 'focused'} `,
    toBeEditable: (args, opts) => {
      // Check if options.editable is explicitly set to false
      const editableValue = opts?.editable;
      if (editableValue === false) {
        // If editable: false, we're checking that element is read-only
        return `'${elementDescription}' is ${negate ? 'editable' : 'read-only'} `;
      } else {
        // Default: checking that element is editable
        return `'${elementDescription}' is ${negate ? 'read-only' : 'editable'} `;
      }
    },
    toBeEmpty: () => `'${elementDescription}' is ${negate ? 'not empty' : 'empty'} `,
    toBeAttached: (args, opts) => {
      // Check if options.attached is explicitly set to false
      const attachedValue = opts?.attached;
      if (attachedValue === false) {
        // If attached: false, we're checking that element is detached
        return `'${elementDescription}' is ${negate ? 'attached to' : 'detached from'} DOM `;
      } else {
        // Default: checking that element is attached
        return `'${elementDescription}' is ${negate ? 'detached from' : 'attached to'} DOM `;
      }
    },
    toHaveAttribute: args => {
      const attrName = args?.name || 'attribute';
      const attrValue = args?.value;
      if (attrValue !== undefined)
        return `'${elementDescription}' attribute "${attrName}" ${negate ? 'does not equal' : 'equals'} "${attrValue}" `;
      return `'${elementDescription}' ${negate ? 'does not have' : 'has'} attribute "${attrName}" `;
    },
    toHaveText: args => {
      const expected = args?.expected || 'text';
      const expectedStr = Array.isArray(expected) ? expected.join(', ') : expected;
      return `'${elementDescription}' text ${negate ? 'does not match' : 'matches'} "${expectedStr}" `;
    },
    toContainText: args => {
      const expected = args?.expected || 'text';
      const expectedStr = Array.isArray(expected) ? expected.join(', ') : expected;
      return `'${elementDescription}' ${negate ? 'does not contain' : 'contains'} text "${expectedStr}" `;
    },
    toHaveValue: args => {
      const value = args?.value !== undefined ? args.value : 'value';
      return `'${elementDescription}' value ${negate ? 'does not equal' : 'equals'} "${value}" `;
    },
    toHaveValues: args => {
      const values = args?.values || [];
      const valuesStr = Array.isArray(values) ? values.join(', ') : String(values);
      return `'${elementDescription}' values ${negate ? 'do not match' : 'match'} [${valuesStr}] `;
    },
    selectHasValue: args => {
      const value = args?.value || 'value';
      return `'${elementDescription}' selected value ${negate ? 'does not equal' : 'equals'} "${value}" `;
    },
    toMatchAriaSnapshot: args => {
      const expected = args?.expected || 'snapshot';
      return `'${elementDescription}' ARIA structure ${negate ? 'does not match' : 'matches'} "${expected}" `;
    },
    toMatchAriaSnapshotOptions: () => `'${elementDescription}' ARIA structure ${negate ? 'does not match' : 'matches'} snapshot with options `,
    toContainClass: args => {
      const expected = args?.expected || 'class';
      const expectedStr = Array.isArray(expected) ? expected.join(' ') : expected;
      return `'${elementDescription}' ${negate ? 'does not contain' : 'contains'} class "${expectedStr}" `;
    },
    toHaveClass: args => {
      const expected = args?.expected || 'class';
      const expectedStr = Array.isArray(expected) ? expected.join(' ') : expected;
      return `'${elementDescription}' classes ${negate ? 'do not match' : 'match'} "${expectedStr}" `;
    },
    toHaveCount: args => {
      const count = args?.count !== undefined ? args.count : 'count';
      return `'${elementDescription}' count ${negate ? 'does not equal' : 'equals'} ${count} as expected`;
    },
    toHaveCSS: args => {
      const cssName = args?.name || 'property';
      const cssValue = args?.value || 'value';
      return `'${elementDescription}' CSS "${cssName}" ${negate ? 'does not equal' : 'equals'} "${cssValue}" `;
    },
    toHaveId: args => {
      const id = args?.id || 'id';
      return `'${elementDescription}' id ${negate ? 'does not equal' : 'equals'} "${id}" `;
    },
    toHaveJSProperty: args => {
      const propName = args?.name || 'property';
      const propValue = args?.value !== undefined ? JSON.stringify(args.value) : 'value';
      return `'${elementDescription}' JS property "${propName}" ${negate ? 'does not equal' : 'equals'} ${propValue} `;
    },
    toHaveRole: args => {
      const role = args?.role || 'role';
      return `'${elementDescription}' role ${negate ? 'does not equal' : 'equals'} "${role}" `;
    },
    toHaveScreenshot: args => {
      const name = args?.name;
      if (name !== undefined) {
        const nameStr = Array.isArray(name) ? name.join(', ') : name;
        return `'${elementDescription}' screenshot ${negate ? 'does not match' : 'matches'} "${nameStr}" `;
      } else {
        return `'${elementDescription}' screenshot ${negate ? 'does not match' : 'matches'} with options `;
      }
    },
    toHaveAccessibleDescription: args => {
      const description = args?.description || 'description';
      return `'${elementDescription}' accessible description ${negate ? 'does not equal' : 'equals'} "${description}" `;
    },
    toHaveAccessibleErrorMessage: args => {
      const errorMessage = args?.errorMessage || 'error message';
      return `'${elementDescription}' accessible error message ${negate ? 'does not equal' : 'equals'} "${errorMessage}" `;
    },
    toHaveAccessibleName: args => {
      const name = args?.name || 'name';
      return `'${elementDescription}' accessible name ${negate ? 'does not equal' : 'equals'} "${name}" `;
    },
  };

  const evidenceFn = passedEvidenceMessages[assertionType];
  if (evidenceFn)
    return evidenceFn(mainArgs, options);
  // fallback to default evidence message
  return `'${elementDescription}' assertion ${negate ? 'should not' : 'should'} passed.`;
}

/**
 * Parse validation result - handles simple 'pass'/'fail' or rich object
 * Returns normalized result with message, expected, actual values
 */
function parseValidationResult(
  result: any,
  elementDescription?: string
): ValidationResult {
  let isPass: boolean;
  let evidenceMessage: string;
  let expectedValue: any = undefined;
  let actualValue: any = undefined;

  // Check if result is a rich object with message
  if (result && typeof result === 'object' && 'result' in result) {
    // Rich result object: { result: 'pass'|'fail', message: '...', expected: ..., actual: ... }
    isPass = result.result === 'pass';
    evidenceMessage = result.message || (isPass ? 'Validation passed' : 'Validation failed');
    expectedValue = result.expected;
    actualValue = result.actual;

    // Enhance message with expected/actual if provided but no custom message
    if (expectedValue !== undefined && actualValue !== undefined && !result.message) {
      const expStr = typeof expectedValue === 'object' ? JSON.stringify(expectedValue) : String(expectedValue);
      const actStr = typeof actualValue === 'object' ? JSON.stringify(actualValue) : String(actualValue);
      const desc = elementDescription || 'Data';
      evidenceMessage = isPass
        ? `✓ ${desc}: Expected "${expStr}" and found "${actStr}"`
        : `✗ ${desc}: Expected "${expStr}" but found "${actStr}"`;
    }
  } else if (result && typeof result === 'object' && 'error' in result) {
    // Error object
    isPass = false;
    const desc = elementDescription ? `on "${elementDescription}"` : '';
    evidenceMessage = `Error executing validation${desc}: ${result.error}`;
    actualValue = result.error;
  } else {
    // Simple 'pass' or 'fail' string
    isPass = result === 'pass';
    const desc = elementDescription ? `on "${elementDescription}"` : '';
    evidenceMessage = isPass
      ? `✓ Validation passed${desc}`
      : `✗ Validation failed${desc}. Result: ${result}`;
  }

  return { isPass, evidenceMessage, expectedValue, actualValue };
}


/**
 * Create validation evidence object
 */
function createValidationEvidence(
  mode: 'data' | 'element',
  jsCode: string,
  evidenceMessage: string,
  options?: {
    expectedValue?: any;
    actualValue?: any;
    dataType?: string;
    element?: string;
    locatorString?: string;
  }
): { command: string; message: string } {
  const command: any = {
    toolName: 'default_validation',
    mode,
    arguments: {
      jsCode,
      ...(options?.expectedValue !== undefined && { expectedValue: options.expectedValue }),
      ...(options?.actualValue !== undefined && { actualValue: options.actualValue }),
      ...(options?.dataType && { dataType: options.dataType }),
    },
  };

  if (mode === 'element' && options?.element) {
    command.locators = [{
      element: options.element,
      locatorString: options.locatorString || ''
    }];
  }

  return {
    command: JSON.stringify(command),
    message: evidenceMessage
  };
}

/**
 * Build validation payload for response
 */
function buildValidationPayload(
  mode: 'data' | 'element',
  jsCode: string,
  validationResult: ValidationResult,
  evidence: { command: string; message: string }[],
  options?: {
    ref?: string;
    element?: string;
    dataPreview?: string;
    error?: string;
  }
): ValidationPayload {
  const { isPass, expectedValue, actualValue } = validationResult;
  const status = isPass ? 'pass' : 'fail';
  const passed = isPass ? 1 : 0;
  const failed = isPass ? 0 : 1;

  const payload: ValidationPayload = {
    mode,
    summary: {
      total: 1,
      passed,
      failed,
      status,
      evidence,
    },
    checks: [{
      property: mode === 'data' ? 'data_validation' : 'validation',
      operator: 'equals',
      expected: expectedValue !== undefined ? expectedValue : 'pass',
      actual: actualValue !== undefined ? actualValue : status,
      result: status,
    }],
    result: status,
    jsCode,
  };

  // Add optional fields
  if (options?.ref)
    payload.ref = options.ref;
  if (options?.element)
    payload.element = options.element;
  if (options?.dataPreview)
    payload.dataPreview = options.dataPreview;
  if (options?.error)
    payload.error = options.error;
  if (expectedValue !== undefined)
    payload.expectedValue = expectedValue;
  if (actualValue !== undefined)
    payload.actualValue = actualValue;

  return payload;
}

/**
 * Build error payload for validation failures
 */
function buildValidationErrorPayload(
  mode: 'data' | 'element',
  jsCode: string,
  errorMessage: string,
  evidence: { command: string; message: string }[],
  options?: {
    ref?: string;
    element?: string;
  }
): ValidationPayload {
  const payload: ValidationPayload = {
    mode,
    summary: {
      total: 1,
      passed: 0,
      failed: 1,
      status: 'fail',
      evidence,
    },
    checks: [{
      property: mode === 'data' ? 'data_validation' : 'javascript_execution',
      operator: 'execute',
      expected: 'pass',
      actual: errorMessage,
      result: 'fail',
    }],
    result: 'fail',
    jsCode,
    error: errorMessage,
  };

  if (options?.ref)
    payload.ref = options.ref;
  if (options?.element)
    payload.element = options.element;

  return payload;
}

export {
  getAllComputedStylesDirect,
  hasAlertDialog,
  getAlertDialogText,
  performRegexCheck,
  performRegexExtract,
  performRegexMatch,
  compareValues,
  getValueByJsonPath,
  checkElementVisibilityUnique,
  checkTextExistenceInAllFrames,
  generateLocatorString,
  collectAllFrames,
  runCommand,
  runCommandClean,
  getAssertionEvidence,
  parseValidationResult,
  createValidationEvidence,
  buildValidationPayload,
  buildValidationErrorPayload,
};
