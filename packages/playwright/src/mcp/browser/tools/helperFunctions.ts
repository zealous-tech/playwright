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
import { execFile } from 'child_process';
import { promisify } from 'util';
import type * as playwright from 'playwright';
import { expect } from '@zealous-tech/playwright/test';
const camelToKebab = (prop: string) =>
  prop.replace(/[A-Z]/g, m => `-${m.toLowerCase()}`);

function pickActualValue(
  all: Record<string, string>,
  name: string
): string | undefined {
  if (name in all)
    return all[name];
  const kebab = camelToKebab(name);
  if (kebab in all)
    return all[kebab];
  const trimmed = name.trim();
  if (trimmed in all)
    return all[trimmed];
  const trimmedKebab = camelToKebab(trimmed);
  if (trimmedKebab in all)
    return all[trimmedKebab];
  return undefined;
}

// Function to parse RGB color values from various CSS color formats
function parseRGBColor(colorValue: string): { r: number; g: number; b: number } | null {
  if (!colorValue)
    return null;

  // Handle rgb(r, g, b) format
  const rgbMatch = colorValue.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (rgbMatch) {
    return {
      r: parseInt(rgbMatch[1]),
      g: parseInt(rgbMatch[2]),
      b: parseInt(rgbMatch[3])
    };
  }

  // Handle rgba(r, g, b, a) format (ignore alpha)
  const rgbaMatch = colorValue.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*[\d.]+\)/);
  if (rgbaMatch) {
    return {
      r: parseInt(rgbaMatch[1]),
      g: parseInt(rgbaMatch[2]),
      b: parseInt(rgbaMatch[3])
    };
  }

  // Handle hex colors (#RRGGBB or #RGB)
  const hexMatch = colorValue.match(/#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})/);
  if (hexMatch) {
    const hex = hexMatch[1];
    if (hex.length === 3) {
      // #RGB format
      return {
        r: parseInt(hex[0] + hex[0], 16),
        g: parseInt(hex[1] + hex[1], 16),
        b: parseInt(hex[2] + hex[2], 16)
      };
    } else {
      // #RRGGBB format
      return {
        r: parseInt(hex.substring(0, 2), 16),
        g: parseInt(hex.substring(2, 4), 16),
        b: parseInt(hex.substring(4, 6), 16)
      };
    }
  }

  // Handle named colors (basic support)
  const namedColors: Record<string, { r: number; g: number; b: number }> = {
    'red': { r: 255, g: 0, b: 0 },
    'green': { r: 0, g: 128, b: 0 },
    'blue': { r: 0, g: 0, b: 255 },
    'black': { r: 0, g: 0, b: 0 },
    'white': { r: 255, g: 255, b: 255 },
    'gray': { r: 128, g: 128, b: 128 },
    'grey': { r: 128, g: 128, b: 128 },
    'yellow': { r: 255, g: 255, b: 0 },
    'cyan': { r: 0, g: 255, b: 255 },
    'magenta': { r: 255, g: 0, b: 255 },
    'orange': { r: 255, g: 165, b: 0 },
    'purple': { r: 128, g: 0, b: 128 },
    'pink': { r: 255, g: 192, b: 203 },
    'brown': { r: 165, g: 42, b: 42 },
    'darkred': { r: 139, g: 0, b: 0 },
    'lightblue': { r: 173, g: 216, b: 230 },
    'darkblue': { r: 0, g: 0, b: 139 },
    'lightgreen': { r: 144, g: 238, b: 144 },
    'darkgreen': { r: 0, g: 100, b: 0 }
  };

  const lowerColor = colorValue.toLowerCase().trim();
  if (namedColors[lowerColor])
    return namedColors[lowerColor];


  return null;
}

// Function to check if RGB color is within specified range
function isColorInRange(actualColor: string, range: { minR: number; maxR: number; minG: number; maxG: number; minB: number; maxB: number }): boolean {
  const rgb = parseRGBColor(actualColor);
  if (!rgb)
    return false;

  return rgb.r >= range.minR && rgb.r <= range.maxR &&
           rgb.g >= range.minG && rgb.g <= range.maxG &&
           rgb.b >= range.minB && rgb.b <= range.maxB;
}

async function getAllComputedStylesDirect(
  tab: any,
  ref: string,
  element: string
): Promise<Record<string, string>> {
  const locator = await tab.refLocator({ ref, element });

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


function compareValues(actual: any, expected: any, operator: string) {
  switch (operator) {
    case 'equals':
      // Convert both to same type for comparison
      if (typeof actual === 'number' && typeof expected === 'string')
        return { passed: actual === Number(expected), actual };
      else if (typeof actual === 'string' && typeof expected === 'number')
        return { passed: Number(actual) === expected, actual };
      else
        return { passed: actual === expected, actual };

    case 'not_equals':
      if (typeof actual === 'number' && typeof expected === 'string')
        return { passed: actual !== Number(expected), actual };
      else if (typeof actual === 'string' && typeof expected === 'number')
        return { passed: Number(actual) !== expected, actual };
      else
        return { passed: actual !== expected, actual };

    case 'contains':
      return { passed: String(actual).includes(String(expected)), actual };
    case 'not_contains':
      return { passed: !String(actual).includes(String(expected)), actual };
    case 'greater_than':
      return { passed: Number(actual) > Number(expected), actual };
    case 'less_than':
      return { passed: Number(actual) < Number(expected), actual };
    case 'hasValue':
      // Check if value exists (not null, undefined, or empty string)
      const hasValue = actual !== null && actual !== undefined && actual !== '';
      return { passed: hasValue === expected, actual: hasValue };
    default:
      return { passed: false, actual: `Unknown operator: ${operator}` };
  }
}



function parseSingleArgument(arg: string): any {
  arg = arg.trim();
  //console.log(`Parsing single argument: "${arg}"`);

  // Handle string arguments first (both single and double quotes)
  if ((arg.startsWith("'") && arg.endsWith("'")) || (arg.startsWith('"') && arg.endsWith('"'))) {
    // String argument: 'Hello' or "Hello"
    const result = arg.slice(1, -1);
    //console.log(`Parsed as string: "${result}"`);
    return result;
  }

  // Handle boolean values
  if (arg === 'true')
    return true;
  else if (arg === 'false')
    return false;
  else if (arg === 'null')
    return null;


  // Handle numbers
  if (!isNaN(Number(arg)))
    return Number(arg);


  // Handle objects and arrays
  if (arg.startsWith('{') && arg.endsWith('}')) {
    // Object argument: { name: 'Submit' } - use eval for simple cases
    try {
      const result = eval(`(${arg})`);
      //console.log(`Parsed object with eval:`, result);
      return result;
    } catch (evalError) {
      // Fallback to JSON parsing
      const jsonString = convertToValidJson(arg);
      console.log(`Converted to JSON: "${jsonString}"`);
      return JSON.parse(jsonString);
    }
  } else if (arg.startsWith('[') && arg.endsWith(']')) {
    // Array argument: ['button', 'submit'] - use eval for simple cases
    try {
      const result = eval(`(${arg})`);
      //console.log(`Parsed array with eval:`, result);
      return result;
    } catch (evalError) {
      // Fallback to JSON parsing
      const jsonString = convertToValidJson(arg);
      console.log(`Converted to JSON: "${jsonString}"`);
      return JSON.parse(jsonString);
    }
  } else {
    // If all else fails, return as string
    console.log(`Parsed as fallback string: "${arg}"`);
    return arg;
  }
}

function convertToValidJson(str: string): string {
  // Simple approach: replace single quotes with double quotes
  // This works for most cases but may not handle all edge cases
  let result = str;

  // Replace single quotes with double quotes, but be careful about escaped quotes
  result = result.replace(/'/g, '"');

  console.log(`convertToValidJson: "${str}" -> "${result}"`);
  return result;
}

interface CurlResponse {
  stdout: string;
  stderr: string;
  statusCode?: number;
  responseTime?: number;
  contentLength?: number;
  contentType?: string;
  server?: string;
  error?: string;
}

interface ParsedCurlResponse {
  data: string | object;
  statusCode?: number;
  responseTime?: number;
  contentLength?: number;
  contentType?: string;
  server?: string;
  error?: string;
  rawStderr?: string;
}

function parseCurlStderr(stderr: string): Partial<CurlResponse> {
  const result: Partial<CurlResponse> = {};

  const statusMatch = stderr.match(/< HTTP\/\d\.\d (\d+)/);
  if (statusMatch)
    result.statusCode = parseInt(statusMatch[1], 10);


  const contentTypeMatch = stderr.match(/< Content-Type: ([^\r\n]+)/);
  if (contentTypeMatch)
    result.contentType = contentTypeMatch[1].trim();


  const contentLengthMatch = stderr.match(/< Content-Length: (\d+)/);
  if (contentLengthMatch)
    result.contentLength = parseInt(contentLengthMatch[1], 10);


  const serverMatch = stderr.match(/< Server: ([^\r\n]+)/);
  if (serverMatch)
    result.server = serverMatch[1].trim();


  const timeMatch = stderr.match(/(\d+\.\d+) secs/);
  if (timeMatch)
    result.responseTime = parseFloat(timeMatch[1]);


  if (stderr.includes('curl:') || stderr.includes('error:')) {
    const errorMatch = stderr.match(/curl: \(\d+\) ([^\r\n]+)/);
    if (errorMatch)
      result.error = errorMatch[1].trim();

  }

  return result;
}

export async function runCommand(command: string): Promise<{ stdout: string; stderr: string }> {
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
        if (v == null)
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

export async function runCommandClean(command: string): Promise<ParsedCurlResponse> {
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
  if (!path || path === '') return obj;
  if (path === null || path === undefined) return undefined;

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
      return undefined;


    // Handle array notation with filters or indices
    if (part.startsWith('[') && part.endsWith(']')) {
      const content = part.slice(1, -1);

      // Handle filter expressions like [?(@.isbn=='9781449325862')]
      if (content.startsWith('?(@')) {
        const filterResult = applyArrayFilter(currentObj, content);
        if (filterResult === undefined)
          return undefined;

        currentObj = filterResult;
      }
      // Handle array indices like [0], [1]
      else {
        const index = parseInt(content, 10);
        if (isNaN(index) || !Array.isArray(currentObj))
          return undefined;

        currentObj = currentObj[index];
      }
    }
    // Handle object properties
    else if (typeof currentObj === 'object' && !Array.isArray(currentObj)) {
      currentObj = currentObj[part];
    } else {
      return undefined;
    }
  }

  return currentObj;
}

function applyArrayFilter(arr: any[], filter: string): any {
  if (!Array.isArray(arr))
    return undefined;


  // Parse filter like "?(@.isbn=='9781449325862')"
  const match = filter.match(/\?\(@\.([^=!<>]+)([=!<>]+)(.+)\)/);
  if (!match)
    return undefined;


  const [, field, operator, value] = match;
  let cleanValue: any = value.replace(/^['"]|['"]$/g, ''); // Remove quotes
  
  // Handle boolean values
  if (cleanValue === 'true') cleanValue = true;
  else if (cleanValue === 'false') cleanValue = false;
  else if (cleanValue === 'null') cleanValue = null;

  // Find matching items
  const results = arr.filter(item => {
    if (typeof item !== 'object' || item === null)
      return false;


    const itemValue = item[field];

    switch (operator) {
      case '==':
        return itemValue == cleanValue;
      case '!=':
        return itemValue != cleanValue;
      case '===':
        return itemValue === cleanValue;
      case '!==':
        return itemValue !== cleanValue;
      case '>':
        return Number(itemValue) > Number(cleanValue);
      case '<':
        return Number(itemValue) < Number(cleanValue);
      case '>=':
        return Number(itemValue) >= Number(cleanValue);
      case '<=':
        return Number(itemValue) <= Number(cleanValue);
      default:
        return false;
    }
  });

  // Return first match, or all matches if multiple
  return results.length === 1 ? results[0] : results;
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
      expect(frameInfo.frame.getByRole(role, { name: accessibleName })).toBeVisible({timeout:2000})
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
 */
async function checkTextVisibilityInAllFrames(page: any, text: string, matchType: 'exact' | 'contains' | 'not-contains' = 'contains') {
  const searchPromises = [];
  
  // Add search in main frame
  let mainLocator;
  if (matchType === 'exact') {
    mainLocator = page.getByText(text, { exact: true });
  } else {
    mainLocator = page.getByText(text);
  }
  
  searchPromises.push(
    expect(mainLocator).toBeVisible()
      .then(() => ({ found: true, frame: 'main', level: 0 }))
      .catch(() => ({ found: false, frame: 'main', level: 0 }))
  );
  
  // Recursively collect all iframes at all levels
  const allFrames = await collectAllFrames(page, 0);
  
  // Create promises for all frames
  for (const frameInfo of allFrames) {
    let frameLocator;
    if (matchType === 'exact') {
      frameLocator = frameInfo.frame.getByText(text, { exact: true });
    } else {
      frameLocator = frameInfo.frame.getByText(text);
    }
    
    searchPromises.push(
      expect(frameLocator).toBeVisible({timeout:2000})
        .then(() => ({ found: true, frame: frameInfo.name, level: frameInfo.level }))
        .catch(() => ({ found: false, frame: frameInfo.name, level: frameInfo.level }))
    );
  }
  
  // Wait for all search results in parallel
  const results = await Promise.all(searchPromises);
  
  return results;
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

export { pickActualValue, parseRGBColor, isColorInRange, getAllComputedStylesDirect, hasAlertDialog, getAlertDialogText, performRegexCheck, performRegexExtract, performRegexMatch, compareValues,parseArguments, parseSingleArgument, convertToValidJson, parseMethodChain, parseMethodCall, applyLocatorMethod, getValueByJsonPath, checkElementVisibilityUnique, checkTextVisibilityInAllFrames };
