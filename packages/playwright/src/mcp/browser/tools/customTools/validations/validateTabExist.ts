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
import { expect } from '@zealous-tech/playwright/test';
import { defineTabTool } from '../../tool';
import { getTimeout } from '../helpers/utils';
import { validateTabExistSchema } from '../helpers/schemas';

export const validate_tab_exist = defineTabTool({
  capability: 'core',
  schema: {
    name: 'validate_tab_exist',
    title: 'Validate Tab Exists',
    description: 'Check if a browser tab with the specified URL exists or does not exist. Use matchType "exist" to verify tab exists, or "not-exist" to verify tab does not exist. exactMatch is ignored when matchType is "not-exist". Optionally validate if the found tab is the current active tab with isCurrent parameter.',
    inputSchema: validateTabExistSchema,
    type: 'readOnly',
  },
  handle: async (tab, params, response) => {
    const { url, title, matchType, exactMatch, isCurrent } = params;

    try {
      // Get all tabs information from context
      const context = tab.context;

      // Determine if url is a valid regex (used by both the scan and the native URL wait)
      let urlRegex: RegExp;
      let isUrlRegex = false;

      try {
        urlRegex = new RegExp(url);
        isUrlRegex = true;
      } catch {
        isUrlRegex = false;
      }

      // Determine if title is a valid regex
      let titleRegex: RegExp | undefined;
      let isTitleRegex = false;
      if (title) {
        try {
          titleRegex = new RegExp(title);
          isTitleRegex = true;
        } catch {
          isTitleRegex = false;
        }
      }

      // Title matching respects exactMatch the same way URL matching does:
      // - exactMatch true  -> require an exact title equality
      // - exactMatch false -> allow regex or partial (contains) title match
      const matchesTitle = (header: string): boolean => {
        if (!title)
          return true;
        if (exactMatch)
          return header === title;
        const regexMatch = isTitleRegex ? titleRegex!.test(header) : false;
        const includes = header.includes(title) || title.includes(header);
        return regexMatch || includes;
      };

      // Mirror the tool's URL-matching semantics so the native wait predicate stays consistent
      // with the tab scan below.
      const matchesUrl = (candidateUrl: string): boolean => {
        if (exactMatch)
          return candidateUrl === url;
        const regexMatch = isUrlRegex ? urlRegex!.test(candidateUrl) : false;
        const includes = candidateUrl.includes(url) || url.includes(candidateUrl);
        return regexMatch || includes;
      };

      // One-shot evaluation of the tab state across all tabs. Pure so it can be re-run after waiting.
      const evaluateOnce = async () => {
        const allTabs = context.tabs();

        // Extract tab info using the correct page methods
        const tabsWithInfo = await Promise.all(
            allTabs.map(async (tabItem: any, index: number) => {
              try {
                const tabUrl = await tabItem.page.url();
                const tabTitle = await tabItem.page.title();
                return { index, header: tabTitle, url: tabUrl };
              } catch {
                return { index, header: 'Unknown', url: 'unknown' };
              }
            })
        );

        // Find current tab URL
        let currentTabUrl = '';
        try {
          currentTabUrl = await tab.page.url();
        } catch (error) {
          console.log('Could not determine current tab URL:', error);
        }

        let searchType = '';

        // Search for tab with matching URL
        const foundTab: any = tabsWithInfo.find((tabInfo: any) => {
          const titleMatch = matchesTitle(tabInfo.header);
          if (exactMatch) {
            searchType = 'exact';
            return tabInfo.url === url && titleMatch;
          }
          const regexMatch = isUrlRegex ? urlRegex!.test(tabInfo.url) : false;
          const includes = tabInfo.url.includes(url) || url.includes(tabInfo.url);
          searchType = includes ? 'partial' : 'regex';
          return (regexMatch || includes) && titleMatch;
        });

        const isFound = !!foundTab;

        // Check if found tab is current tab (if isCurrent is specified)
        let isCurrentTab = false;
        if (isFound && isCurrent !== undefined)
          isCurrentTab = (foundTab as any).url === currentTabUrl;

        // Determine final result based on matchType and isCurrent
        const currentMatch = isCurrent === undefined ? true : (isCurrent ? isCurrentTab : !isCurrentTab);
        const urlMatch = matchType === 'exist' ? isFound : !isFound;
        const status = (urlMatch && currentMatch) ? 'pass' : 'fail';

        return { tabsWithInfo, currentTabUrl, foundTab, isFound, isCurrentTab, searchType, status };
      };

      let evaluation = await evaluateOnce();
      if (evaluation.status !== 'pass') {
        try {
          const urlAssertion = expect(tab.page);
          const predicate = (u: URL) => matchesUrl(u.href);
          if (matchType === 'exist')
            await urlAssertion.toHaveURL(predicate, { timeout: getTimeout(context) });
          else
            await urlAssertion.not.toHaveURL(predicate, { timeout: getTimeout(context) });
        } catch {
          // Timed out waiting for the URL condition; the final evaluation reports the failure.
        }
        evaluation = await evaluateOnce();
      }

      const { tabsWithInfo, currentTabUrl, foundTab, isFound, isCurrentTab, searchType, status } = evaluation;
      // Generate evidence message
      let evidence = '';
      let currentInfo = '';
      if (isCurrent !== undefined) {
        if (isFound)
          currentInfo = ` Found tab is ${isCurrentTab ? '' : 'not '}current tab. Expected: ${isCurrent ? 'current' : 'not current'}.`;
        else
          currentInfo = ` Current tab check: ${isCurrent ? 'expected current tab not found' : 'expected non-current tab not found'}.`;
      }
      const titleInfo = title ? `, title: "${title}"` : '';
      const titleMessage = title ? ` and TITLE "${title}"` : '';

      if (matchType === 'exist') {
        if (isFound && foundTab) {
          evidence = `Found tab with ${url} ${searchType} check URL match: "${(foundTab as any).url}" (index: ${(foundTab as any).index}, header: "${(foundTab as any).header}"${titleInfo})${currentInfo}`;
        } else {
          const availableUrls = tabsWithInfo.map((t: any) => (t as any).url).join(', ');
          evidence = `Tab with URL "${url}"${titleMessage} not found. Available tabs: ${availableUrls}${currentInfo}`;
        }
      } else { // matchType === 'not-exist'
        if (!isFound)
          evidence = `Tab with URL "${url}"${titleMessage} does not exist (as expected). Available tabs: ${tabsWithInfo.map((t: any) => (t as any).url).join(', ')}${currentInfo}`;
        else
          evidence = `Tab with URL "${url}"${titleMessage} exists (unexpected). Found: "${(foundTab as any).url}" (index: ${(foundTab as any).index}, header: "${(foundTab as any).header}${titleInfo})")${currentInfo}`;

      }

      // Generate evidence as array of objects with command and message
      const evidenceArray = [{
        command: JSON.stringify({
          toolName: 'validate_tab_exist',
          arguments: {
            url,
            title,
            matchType,
            exactMatch,
            isCurrent
          }
        }),
        message: evidence
      }];

      const payload = {
        url,
        title,
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
      response.addTextResult(JSON.stringify(payload, null, 2));

    } catch (error) {
      const errorMessage = `Failed to validate tab existence.`;
      console.log(`Failed to validate tab existence. Error: ${error instanceof Error ? error.message : String(error)}`);

      // Generate evidence as array of objects with command and message
      const errorEvidence = [{
        command: JSON.stringify({
          toolName: 'validate_tab_exist',
          arguments: {
            url,
            title,
            matchType,
            exactMatch,
            isCurrent
          }
        }),
        message: errorMessage
      }];

      const errorPayload = {
        url,
        title,
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
      response.addTextResult(JSON.stringify(errorPayload, null, 2));
    }
  },
});
