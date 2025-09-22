import { execFile } from 'child_process';
import type * as playwright from 'playwright';
import { promisify } from 'util';

const camelToKebab = (prop: string) =>
    prop.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
  
  function pickActualValue(
    all: Record<string, string>,
    name: string
  ): string | undefined {
    if (name in all) return all[name];
    const kebab = camelToKebab(name);
    if (kebab in all) return all[kebab];
    const trimmed = name.trim();
    if (trimmed in all) return all[trimmed];
    const trimmedKebab = camelToKebab(trimmed);
    if (trimmedKebab in all) return all[trimmedKebab];
    return undefined;
  }
  
  // Function to parse RGB color values from various CSS color formats
  function parseRGBColor(colorValue: string): { r: number; g: number; b: number } | null {
    if (!colorValue) return null;
    
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
    if (namedColors[lowerColor]) {
      return namedColors[lowerColor];
    }
    
    return null;
  }
  
  // Function to check if RGB color is within specified range
  function isColorInRange(actualColor: string, range: { minR: number; maxR: number; minG: number; maxG: number; minB: number; maxB: number }): boolean {
    const rgb = parseRGBColor(actualColor);
    if (!rgb) return false;
    
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



  async function getAllDomPropsDirect(tab: any, ref: string, element: string) {
    const locator = await tab.refLocator({ ref, element });
    const props = await locator.evaluate(
      (el: Element) => {
        if (!el) return {};
  
        const out: Record<string, any> = {};
  
        // Collect all "own" properties of the element
        for (const key of Object.keys(el)) {
          try {
            const val = (el as any)[key];
            // filter only primitives for readability
            if (["string", "number", "boolean"].includes(typeof val) || val === null) {
              out[key] = val;
            }
          } catch (_) {
            // skip getters with errors
          }
        }
        console.log("1111 Props:", out);
        console.dir(out, { depth: null });
  
        // + useful attributes
        if (el.getAttributeNames) {
          el.getAttributeNames().forEach((attr: string) => {
            out[`attr:${attr}`] = el.getAttribute(attr);
          });
        }
  
        // Handle special cases for common attributes
        // For disabled attribute, check both the property and the attribute
        if (el.hasAttribute('disabled')) {
          out['disabled'] = true;
        } else if ((el as any).disabled !== undefined) {
          out['disabled'] = (el as any).disabled;
        }
  
        // For checked attribute, check both the property and the attribute
        if (el.hasAttribute('checked')) {
          out['checked'] = true;
        } else if ((el as any).checked !== undefined) {
          out['checked'] = (el as any).checked;
        }
  
        // For value attribute, prioritize the property over attribute
        if ((el as any).value !== undefined) {
          out['value'] = (el as any).value;
        } else if (el.hasAttribute('value')) {
          out['value'] = el.getAttribute('value');
        }
  
        return out;
      }
    );
  
    return props ?? {};
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
  if (!hasAlertDialog(snapshotContent)) {
    return null;
  }
  
  // Look for dialog message pattern: "dialog with message "text""
  const dialogMatch = snapshotContent.match(/dialog with message "([^"]+)"/);
  if (dialogMatch) {
    return dialogMatch[1];
  }
  
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
    
    if (!match) {
      return { passed: false, actual: 'Pattern not found' };
    }
    
    const extractedValue = match[check.extractGroup || 1];
    if (extractedValue === undefined) {
      return { passed: false, actual: `Capture group ${check.extractGroup || 1} not found` };
    }
    
    // If no expected value, just return success
    if (check.expected === undefined) {
      return { passed: true, actual: extractedValue };
    }
    
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
        if (typeof actual === 'number' && typeof expected === 'string') {
          return { passed: actual === Number(expected), actual };
        } else if (typeof actual === 'string' && typeof expected === 'number') {
          return { passed: Number(actual) === expected, actual };
        } else {
          return { passed: actual === expected, actual };
        }
      case 'not_equals':
        if (typeof actual === 'number' && typeof expected === 'string') {
          return { passed: actual !== Number(expected), actual };
        } else if (typeof actual === 'string' && typeof expected === 'number') {
          return { passed: Number(actual) !== expected, actual };
        } else {
          return { passed: actual !== expected, actual };
        }
      case 'contains':
        return { passed: String(actual).includes(String(expected)), actual };
      case 'not_contains':
        return { passed: !String(actual).includes(String(expected)), actual };
      case 'greater_than':
        return { passed: Number(actual) > Number(expected), actual };
      case 'less_than':
        return { passed: Number(actual) < Number(expected), actual };
      default:
        return { passed: false, actual: `Unknown operator: ${operator}` };
    }
  }

// Recursive function to search for text in all frames (including nested iframes)
async function searchInAllFrames(
  page: any, 
  text: string, 
  matchType: 'exact' | 'contains' | 'not-contains' = 'contains',
  framePath: string = 'main'
): Promise<Array<{element: any, context: string}>> {
  const results: Array<{element: any, context: string}> = [];
  
  try {
    // Search in current frame with appropriate options based on matchType
    let locator;
    if (matchType === "exact") {
      locator = page.getByText(text, { exact: true }).filter({ visible: true });
    } else {
      // For "contains" and "not-contains", use default substring matching
      locator = page.getByText(text).filter({ visible: true });
    }
    
    const count = await locator.count();
    console.log(`searchInAllFrames: Found ${count} visible elements with text "${text}" in ${framePath} (matchType: ${matchType})`);
    
    if (count > 0) {
      const elements = await locator.all();
      results.push(...elements.map((el: any) => ({ element: el, context: framePath })));
    }
    
    // Find all iframes in current frame
    const iframes = page.locator('iframe');
    const iframeCount = await iframes.count();
    
    // Search in each iframe recursively
    for (let i = 0; i < iframeCount; i++) {
      try {
        const iframePage = page.frameLocator(`iframe >> nth=${i}`);
        const nestedResults = await searchInAllFrames(iframePage, text, matchType, `${framePath} > iframe-${i + 1}`);
        results.push(...nestedResults);
      } catch (error) {
        console.log(`searchInAllFrames: Error searching in ${framePath} > iframe-${i + 1}:`, error);
      }
    }
  } catch (error) {
    console.log(`searchInAllFrames: Error searching in ${framePath}:`, error);
  }
  
  return results;
}

// Function to get text from element with comprehensive fallbacks
async function getElementTextWithFallbacks(
  locator: any,
  tab: any,
  elementDescription: string
): Promise<string> {
  let actualText = "";
  
  // First try: get text content
  actualText = (await locator.textContent() ?? "").trim();
  
  // If no text found, try fallback properties
  if (!actualText) {
    console.log(`Text content is empty for element ${elementDescription}, trying fallback properties...`);
    
    // Try input value first (works for input, textarea, select)
    try {
      actualText = await locator.inputValue();
    } catch (error) {
      // Not an input-like element, try other attributes
    }
    
    if (!actualText) {
      // Try placeholder
      const placeholder = await locator.getAttribute('placeholder');
      if (placeholder) {
        actualText = placeholder;
      }
    }
    
    if (!actualText) {
      // Try defaultValue
      const defaultValue = await locator.getAttribute('defaultValue');
      if (defaultValue) {
        actualText = defaultValue;
      }
    }
    
    if (!actualText) {
      // Try aria-label
      const ariaLabel = await locator.getAttribute('aria-label');
      if (ariaLabel) {
        actualText = ariaLabel;
      }
    }
    
    if (!actualText) {
      // Check for contenteditable
      const isContentEditable = await locator.getAttribute('contenteditable');
      if (isContentEditable === 'true') {
        actualText = await locator.innerHTML();
      }
    }
    
    if (!actualText) {
      // Try title attribute
      const title = await locator.getAttribute('title');
      if (title) {
        actualText = title;
      }
    }
    
    if (!actualText) {
      // Try alt attribute (for images)
      const alt = await locator.getAttribute('alt');
      if (alt) {
        actualText = alt;
      }
    }
    
    if (!actualText) {
      // Try value attribute (for elements with value)
      const value = await locator.getAttribute('value');
      if (value) {
        actualText = value;
      }
    }
    
    if (!actualText) {
      // Try data attributes (common patterns)
      const dataValue = await locator.getAttribute('data-value');
      if (dataValue) {
        actualText = dataValue;
      }
    }
    
    if (!actualText) {
      // Try aria-labelledby (references another element)
      const ariaLabelledBy = await locator.getAttribute('aria-labelledby');
      if (ariaLabelledBy) {
        try {
          // Try to find the referenced element
          const referencedElement = tab.page.locator(`#${ariaLabelledBy}`);
          if (await referencedElement.count() > 0) {
            actualText = await referencedElement.textContent() ?? "";
          }
        } catch (error) {
          // Ignore errors when trying to find referenced element
        }
      }
    }
    
    if (!actualText) {
      // Try aria-describedby (references another element)
      const ariaDescribedBy = await locator.getAttribute('aria-describedby');
      if (ariaDescribedBy) {
        try {
          // Try to find the referenced element
          const referencedElement = tab.page.locator(`#${ariaDescribedBy}`);
          if (await referencedElement.count() > 0) {
            actualText = await referencedElement.textContent() ?? "";
          }
        } catch (error) {
          // Ignore errors when trying to find referenced element
        }
      }
    }
    
    if (!actualText) {
      // Try option text for select elements
      try {
        const tagName = await locator.evaluate((el: Element) => el.tagName.toLowerCase());
        if (tagName === 'select') {
          const selectedOption = await locator.evaluate((el: HTMLSelectElement) => {
            const selectedIndex = el.selectedIndex;
            return selectedIndex >= 0 ? el.options[selectedIndex]?.textContent || '' : '';
          });
          if (selectedOption) {
            actualText = selectedOption;
          }
        }
      } catch (error) {
        // Not a select element or error occurred
      }
    }
    
    if (!actualText) {
      // Try innerText as fallback (includes visible text only)
      try {
        actualText = await locator.innerText();
      } catch (error) {
        // Element might not support innerText
      }
    }
    
    console.log(`Fallback result for ${elementDescription}: "${actualText}"`);
  }
  
  return actualText;
}

// Recursive function to search for elements by role in all frames (including nested iframes)
async function searchElementsByRoleInAllFrames(
  page: any, 
  role: string, 
  accessibleName: string,
  framePath: string = 'main'
): Promise<Array<{element: any, context: string}>> {
  const results: Array<{element: any, context: string}> = [];
  
  try {
    // Search in current frame
    const locator = page.getByRole(role as any, { name: accessibleName, exact: true });
    const count = await locator.count();
    console.log(`searchElementsByRoleInAllFrames: Found ${count} elements with role="${role}" and name="${accessibleName}" in ${framePath}`);
    
    if (count > 0) {
      const elements = await locator.all();
      results.push(...elements.map((el: any) => ({ element: el, context: framePath })));
    }
    
    // Find all iframes in current frame
    const iframes = page.locator('iframe');
    const iframeCount = await iframes.count();
    
    // Search in each iframe recursively
    for (let i = 0; i < iframeCount; i++) {
      try {
        const iframePage = page.frameLocator(`iframe >> nth=${i}`);
        const nestedResults = await searchElementsByRoleInAllFrames(iframePage, role, accessibleName, `${framePath} > iframe-${i + 1}`);
        results.push(...nestedResults);
      } catch (error) {
        console.log(`searchElementsByRoleInAllFrames: Error searching in ${framePath} > iframe-${i + 1}:`, error);
      }
    }
  } catch (error) {
    console.log(`searchElementsByRoleInAllFrames: Error searching in ${framePath}:`, error);
  }
  
  return results;
}

async function getFullXPath(tab: any, params: { element: string, ref: string }): Promise<Array<{selector: string; priority: number; type: string}>> {
  const locator = await tab.refLocator(params);
  
  // Generate full absolute XPath path like /html/body/div[2]/div/div/div/div[2]/div[2]/div[3]/button
  const fullXPath = await locator.evaluate((el: Element) => {
    const getXPath = (element: Element): string => {
      if (element.nodeType === Node.DOCUMENT_NODE) {
        return '';
      }
      
      if (element.nodeType === Node.ELEMENT_NODE) {
        const tagName = element.tagName.toLowerCase();
        
        // Count siblings with the same tag name
        let index = 1;
        let sibling = element.previousElementSibling;
        while (sibling) {
          if (sibling.tagName === element.tagName) {
            index++;
          }
          sibling = sibling.previousElementSibling;
        }
        
        // Build the path with index if there are multiple siblings with same tag
        const hasMultipleSiblings = element.nextElementSibling && 
          Array.from(element.parentElement?.children || [])
            .filter(child => child.tagName === element.tagName).length > 1;
        
        const indexPart = hasMultipleSiblings ? `[${index}]` : '';
        const currentPath = `/${tagName}${indexPart}`;
        
        // Recursively get parent path
        const parentPath = element.parentElement ? getXPath(element.parentElement) : '';
        
        return parentPath + currentPath;
      }
      
      return '';
    };
    
    return getXPath(el);
  });

  // Return in the same structure as getStableSelectors but with single element
  return [{
    selector: fullXPath,
    priority: 1,
    type: 'full-xpath'
  }];
}

type StableSel = { selector: string; priority: number; type: string };

const DYNAMIC_ID_RE =
  /(^\d+$)|([a-f0-9]{6,})|(^react|^ember|^vue|^svelte|^ng-)|(^[_-]?\w{8,}[_-]\w{4,})/i;
const HASH_CLASS_RE = /(^_|__|^css-|^chakra-|^Mui|^ant-)|[a-f0-9]{6,}/i;

function esc(s: string) { return s.replace(/(["\\])/g, '\\$1'); }

function looksStableId(id?: string | null) {
  return !!id && !DYNAMIC_ID_RE.test(id);
}
function keepStableClasses(cls: string) {
  return cls
    .split(/\s+/)
    .filter(Boolean)
    .filter(c => !HASH_CLASS_RE.test(c))
    .slice(0, 3); // не увлекайся классами
}

export async function getStableSelectors(
  tab: any,
  params: { element: string; ref: string }
): Promise<StableSel[]> {
  const refLocator = await tab.refLocator(params);
  const handle = await refLocator.elementHandle();
  if (!handle) return [];

  // --- собрать сигналы внутри страницы ---
  const info = await handle.evaluate((el: Element) => {
    const tag = el.tagName.toLowerCase();
    const id = (el as HTMLElement).id || null;
    const roleAttr = (el as HTMLElement).getAttribute('role') || null;
    const testid =
      (el as HTMLElement).getAttribute('data-testid') ||
      (el as HTMLElement).getAttribute('data-test') ||
      null;
    const name = (el as HTMLElement).getAttribute('name') || null;
    const type = (el as HTMLElement).getAttribute('type') || null;
    const placeholder = (el as HTMLElement).getAttribute('placeholder') || null;
    const ariaLabel = (el as HTMLElement).getAttribute('aria-label') || null;
    const ariaLabelledBy = (el as HTMLElement).getAttribute('aria-labelledby') || null;
    const title = (el as HTMLElement).getAttribute('title') || null;
    const alt = (el as HTMLImageElement).getAttribute?.('alt') || null;
    const classes = (el as HTMLElement).className || '';
    const text = (el as HTMLElement).innerText?.replace(/\s+/g, ' ').trim() || '';

    // упрощённое доступное имя
    let accName =
      ariaLabel ||
      (ariaLabelledBy &&
        Array.from(
          (el.getRootNode() as Document | ShadowRoot).querySelectorAll(
            ariaLabelledBy
              .split(/\s+/)
              .map(id => `#${CSS.escape(id)}`)
              .join(',')
          )
        )
          .map(n => (n as HTMLElement).innerText?.trim() || '')
          .filter(Boolean)
          .join(' ')
      ) ||
      (tag === 'input' && (placeholder || name)) ||
      (title || alt) ||
      text || null;

    // найти «якорь» — ближайший стабильный предок
    function anchorSelector(n: Element | null): string | null {
      while (n && n !== document.documentElement) {
        const nid = (n as HTMLElement).id;
        if (nid && !/^\d+$/.test(nid)) return `#${CSS.escape(nid)}`;
        const tqa =
          (n as HTMLElement).getAttribute('data-testid') ||
          (n as HTMLElement).getAttribute('data-qa');
        if (tqa) return `[data-testid="${CSS.escape(tqa)}"],[data-qa="${CSS.escape(tqa)}"]`;
        const role = (n as HTMLElement).getAttribute('role');
        const al = (n as HTMLElement).getAttribute('aria-label');
        if (role && ['main','navigation','banner','contentinfo','form','dialog','region'].includes(role)) {
          return al ? `${n.tagName.toLowerCase()}[role="${role}"][aria-label="${CSS.escape(al)}"]`
                    : `${n.tagName.toLowerCase()}[role="${role}"]`;
        }
        n = n.parentElement;
      }
      return null;
    }

    // shadow chain (если внутри теневого DOM)
    const chain: string[] = [];
    let root = el.getRootNode();
    let cur: Element | null = el;
    while (root && (root as any).host) {
      const host: Element = (root as ShadowRoot).host;
      const hid = (host as HTMLElement).id;
      if (hid) chain.unshift(`#${hid}`);
      else chain.unshift(host.tagName.toLowerCase());
      cur = host;
      root = host.getRootNode();
    }

    return {
      tag,
      id,
      roleAttr,
      testid,
      name,
      type,
      placeholder,
      ariaLabel,
      title,
      alt,
      classes,
      text: text.slice(0, 120),
      accName: accName ? accName.slice(0, 120) : null,
      anchor: anchorSelector(el.parentElement),
      shadowChain: chain, // от документа к целевому host'у
    };
  });

  const frame = await handle.ownerFrame();

  // --- собрать кандидатов (не все пройдут проверку уникальности) ---
  const cand: StableSel[] = [];

  // 1) data-testid / data-test
  if (info.testid) {
    cand.push({ selector: `[data-testid="${esc(info.testid)}"]`, priority: 1, type: 'data-testid' });
    cand.push({ selector: `[data-test="${esc(info.testid)}"]`, priority: 2, type: 'data-test' });
  }

  // 2) #id (только если выглядит стабильно)
  if (looksStableId(info.id)) {
    cand.push({ selector: `#${esc(info.id!)}`, priority: 3, type: 'id' });
  }

  // 3) role + accessible name  (Playwright-движок 'role=')
  if (info.roleAttr && info.accName) {
    cand.push({
      selector: `role=${info.roleAttr}[name="${esc(info.accName)}"]`,
      priority: 4,
      type: 'role'
    });
  }

  // 4) input-атрибуты
  if (info.tag === 'input' || info.tag === 'textarea' || info.tag === 'select') {
    if (info.name) cand.push({ selector: `${info.tag}[name="${esc(info.name)}"]`, priority: 5, type: 'name' });
    if (info.placeholder) cand.push({ selector: `${info.tag}[placeholder="${esc(info.placeholder)}"]`, priority: 6, type: 'placeholder' });
    if (info.type) cand.push({ selector: `${info.tag}[type="${esc(info.type)}"]`, priority: 7, type: 'type' });
  }

  // 5) устойчивые классы (ограничить)
  const stableClasses = keepStableClasses(info.classes || '');
  if (stableClasses.length) {
    cand.push({ selector: `.${stableClasses.map(esc).join('.')}`, priority: 8, type: 'class' });
  }

  // 6) короткий видимый текст (Playwright ':has-text()')
  if (info.text && info.text.length <= 50) {
    cand.push({ selector: `${info.tag}:has-text("${esc(info.text)}")`, priority: 9, type: 'text' });
  }

  // 7) якорь + путь
  if (info.anchor) {
    if (info.name) cand.push({ selector: `${info.anchor} ${info.tag}[name="${esc(info.name)}"]`, priority: 10, type: 'anchor+name' });
    if (stableClasses.length) cand.push({ selector: `${info.anchor} .${stableClasses.map(esc).join('.')} ${info.tag}`, priority: 11, type: 'anchor+class' });
    if (info.text && info.text.length <= 50) {
      cand.push({ selector: `${info.anchor} ${info.tag}:has-text("${esc(info.text)}")`, priority: 12, type: 'anchor+text' });
    }
  }

  // 8) fallback: комбо атрибутов тега
  const pairs: Array<[string,string]> = [];
  if (info.type) pairs.push(['type', info.type]);
  if (info.name) pairs.push(['name', info.name]);
  if (info.placeholder) pairs.push(['placeholder', info.placeholder]);
  if (pairs.length) {
    const sel = info.tag + pairs.map(([k,v]) => `[${k}="${esc(v)}"]`).join('');
    cand.push({ selector: sel, priority: 13, type: 'tag-attrs' });
  }

  // 9) самый крайний случай — минимальный уникальный CSS с nth-of-type от якоря/тела
  async function minimalUniqueCss(): Promise<string | null> {
    return await handle.evaluate((el: Element) => {
      const isUnique = (sel: string) => {
        try {
          const m = document.querySelectorAll(sel);
          return m.length === 1 && m[0] === el;
        } catch { return false; }
      };
      const token = (n: Element) => {
        const t = n.tagName.toLowerCase();
        const id = (n as HTMLElement).id;
        if (id && !/^\d+$/.test(id)) return `#${CSS.escape(id)}`;
        const tqa = (n as HTMLElement).getAttribute('data-testid');
        if (tqa) return `[data-testid="${CSS.escape(tqa)}"]`;
        const name = (n as HTMLElement).getAttribute('name');
        if (name && ['input','textarea','select'].includes(t)) return `${t}[name="${CSS.escape(name)}"]`;
        // nth-of-type
        const parent = n.parentElement;
        if (!parent) return t;
        const same = Array.from(parent.children).filter(c => c.tagName === n.tagName);
        const idx = same.indexOf(n) + 1;
        return `${t}:nth-of-type(${idx})`;
      };
      let path: string[] = [];
      let cur: Element | null = el;
      while (cur && cur.nodeType === 1) {
        path.unshift(token(cur));
        const css = path.join(' > ');
        if (isUnique(css)) return css;
        cur = cur.parentElement;
      }
      return null;
    });
  }

  const minCss = await minimalUniqueCss();
  if (minCss) cand.push({ selector: minCss, priority: 99, type: 'min-css' });

  // --- добавить shadow-piercing, если нужно ---
  function withShadow(selector: string): string {
    if (!info.shadowChain.length) return selector;
    // host1 >>> host2 >>> selector
    return `${info.shadowChain.join(' >>> ')} >>> ${selector}`;
  }
  const withPiercing = cand.map(c => ({ ...c, selector: withShadow(c.selector) }));

  // --- валидация уникальности каждым кандидатом (именно Playwright) ---
  const uniques: StableSel[] = [];
  const seen = new Set<string>();

  for (const c of withPiercing.sort((a,b) => a.priority - b.priority)) {
    try {
      const count = await frame.locator(c.selector).count();
      if (count === 1) {
        const key = c.selector;
        if (!seen.has(key)) {
          seen.add(key);
          uniques.push(c);
        }
      }
    } catch {
      // пропускаем некорректные для движка селекторы
    }
    if (uniques.length >= 5) break; // достаточно 3–5 стабильных вариантов
  }

  // Гарантия: хотя бы один селектор вернём
  if (uniques.length === 0 && minCss) {
    uniques.push({ selector: withShadow(minCss), priority: 100, type: 'min-css' });
  }

  return uniques;
}

function parseArguments(argsString: string): any[] {
  const args: any[] = [];
  let current = '';
  let depth = 0;
  let inString = false;
  let stringChar = '';
  
  for (let i = 0; i < argsString.length; i++) {
    const char = argsString[i];
    const prevChar = i > 0 ? argsString[i - 1] : '';
    
    if (!inString) {
      if (char === '"' || char === "'") {
        inString = true;
        stringChar = char;
        current += char;
      } else if (char === '{' || char === '[') {
        depth++;
        current += char;
      } else if (char === '}' || char === ']') {
        depth--;
        current += char;
      } else if (char === ',' && depth === 0) {
        args.push(parseSingleArgument(current.trim()));
        current = '';
      } else {
        current += char;
      }
    } else {
      current += char;
      if (char === stringChar && prevChar !== '\\') {
        inString = false;
        stringChar = '';
      }
    }
  }
  
  if (current.trim()) {
    args.push(parseSingleArgument(current.trim()));
  }
  
  return args;
}

function parseSingleArgument(arg: string): any {
  arg = arg.trim();
  console.log(`Parsing single argument: "${arg}"`);
  
  // Handle string arguments first (both single and double quotes)
  if ((arg.startsWith("'") && arg.endsWith("'")) || (arg.startsWith('"') && arg.endsWith('"'))) {
    // String argument: 'Hello' or "Hello"
    const result = arg.slice(1, -1);
    console.log(`Parsed as string: "${result}"`);
    return result;
  }
  
  // Handle boolean values
  if (arg === 'true') {
    return true;
  } else if (arg === 'false') {
    return false;
  } else if (arg === 'null') {
    return null;
  }
  
  // Handle numbers
  if (!isNaN(Number(arg))) {
    return Number(arg);
  }
  
  // Handle objects and arrays
  if (arg.startsWith('{') && arg.endsWith('}')) {
    // Object argument: { name: 'Submit' } - use eval for simple cases
    try {
      const result = eval(`(${arg})`);
      console.log(`Parsed object with eval:`, result);
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
      console.log(`Parsed array with eval:`, result);
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

function parseMethodChain(methodChain: string): Array<{ method: string, args: any[] }> {
  const methods: Array<{ method: string, args: any[] }> = [];
  
  // Split by dots, but be careful about dots inside parentheses
  let current = '';
  let depth = 0;
  let inString = false;
  let stringChar = '';
  
  for (let i = 0; i < methodChain.length; i++) {
    const char = methodChain[i];
    const prevChar = i > 0 ? methodChain[i - 1] : '';
    
    if (!inString) {
      if (char === '"' || char === "'") {
        inString = true;
        stringChar = char;
        current += char;
      } else if (char === '(') {
        depth++;
        current += char;
      } else if (char === ')') {
        depth--;
        current += char;
      } else if (char === '.' && depth === 0) {
        if (current.trim()) {
          methods.push(parseMethodCall(current.trim()));
        }
        current = '';
      } else if (char === ')' && depth === 0 && current.trim().endsWith('(')) {
        // Handle methods without arguments like first()
        current += char;
        if (current.trim()) {
          methods.push(parseMethodCall(current.trim()));
        }
        current = '';
      } else {
        current += char;
      }
    } else {
      current += char;
      if (char === stringChar && prevChar !== '\\') {
        inString = false;
        stringChar = '';
      }
    }
  }
  
  if (current.trim()) {
    methods.push(parseMethodCall(current.trim()));
  }
  
  return methods;
}

function parseMethodCall(methodCall: string): { method: string, args: any[] } {
  // Match method name and arguments: methodName(args)
  const match = methodCall.match(/^(\w+)\((.+)\)$/);
  if (!match) {
    // Method without arguments - check if it ends with ()
    const noArgsMatch = methodCall.match(/^(\w+)\(\)$/);
    if (noArgsMatch) {
      const [, methodName] = noArgsMatch;
      return { method: methodName, args: [] };
    }
    // Method without parentheses (like 'first' instead of 'first()')
    return { method: methodCall, args: [] };
  }
  
  const [, methodName, argsString] = match;
  const args = parseArguments(argsString);
  
  return { method: methodName, args };
}

function applyLocatorMethod(locator: playwright.Locator, methodInfo: { method: string, args: any[] }): playwright.Locator {
  const { method, args } = methodInfo;
  
  // Check if method exists on locator
  if (typeof (locator as any)[method] !== 'function') {
    throw new Error(`Unknown locator method: ${method}`);
  }
  
  try {
    const methodFunc = (locator as any)[method] as Function;
    return methodFunc.apply(locator, args);
  } catch (error) {
    throw new Error(`Failed to apply locator method ${method}: ${error instanceof Error ? error.message : String(error)}`);
  }
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

        if (quote) throw new Error('Unclosed quote in command');
        if (inToken) out.push(cur);           // flush final token (even if it's "")
        return out;
      }

    function basicGuard(raw: string) {
        if (SHELL_META.test(raw)) throw new Error('Shell metacharacters are not allowed.');
        if (raw.length > 20_000) throw new Error('Command too long.');
    }

    function validateUrl(raw: string) {
        let u: URL;
        try { u = new URL(raw); } catch { throw new Error(`Invalid URL: ${raw}`); }
        if (u.protocol !== 'http:' && u.protocol !== 'https:') {
            throw new Error('Only HTTP/HTTPS URLs are allowed.');
        }
        if (u.username || u.password) throw new Error('Credentials in URL are not allowed.');
        if (u.href.length > 4096) throw new Error('URL too long.');
    }

    function parseAndValidateCurlArgs(rawCurl: string): string[] {
        basicGuard(rawCurl);
        const tokens = tokenize(rawCurl.trim());
        if (tokens.length === 0) throw new Error('Empty curl command');
        if (tokens[0] !== 'curl') throw new Error('Only curl is allowed.');

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

            if (FORBIDDEN_FLAGS.has(t)) throw new Error(`Flag not allowed: ${t}`);
            if (!ALLOWED_FLAGS.has(t)) throw new Error(`Unsupported flag: ${t}`);
            args.push(t);

            const expectsValue = new Set([
                '-X', '--request',
                '-H', '--header',
                '--max-time', '--connect-timeout',
                '-d', '--data', '--data-raw', '--data-binary', '--data-urlencode'
            ]);

            if (expectsValue.has(t)) {
                const v = tokens[++i];
                if (v == null) throw new Error(`Flag ${t} requires a value`);

                if ((t === '-d' || t.startsWith('--data')) && v.startsWith('@')) {
                    throw new Error('Reading data from files is not allowed.');
                }
                if ((t === '-H' || t === '--header') && v.length > 8_192) {
                    throw new Error('Header value too long.');
                }
                args.push(v);
            }
        }

        if (urlCount === 0) throw new Error('URL is required.');
        if (urlCount > 1) throw new Error('Multiple URLs are not allowed.');
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


export { pickActualValue, parseRGBColor, isColorInRange, getAllComputedStylesDirect, getAllDomPropsDirect, hasAlertDialog, getAlertDialogText, performRegexCheck, performRegexExtract, performRegexMatch, compareValues, searchInAllFrames, searchElementsByRoleInAllFrames, getElementTextWithFallbacks, getFullXPath, parseArguments, parseSingleArgument, convertToValidJson, parseMethodChain, parseMethodCall, applyLocatorMethod };