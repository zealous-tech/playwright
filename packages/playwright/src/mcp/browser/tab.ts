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

import { EventEmitter } from 'events';
import * as playwright from 'playwright-core';
import { ManualPromise } from 'playwright-core/lib/utils';

import { callOnPageNoTrace, waitForCompletion } from './tools/utils';
import { logUnhandledError } from '../log';
import { ModalState } from './tools/tool';
import { parseArguments, parseMethodChain, parseMethodCall, applyLocatorMethod } from './tools/helperFunctions';
import type { Context } from './context';

type PageEx = playwright.Page & {
  _snapshotForAI: () => Promise<string>;
};

export const TabEvents = {
  modalState: 'modalState'
};

export type TabEventsInterface = {
  [TabEvents.modalState]: [modalState: ModalState];
};

export type TabSnapshot = {
  url: string;
  title: string;
  ariaSnapshot: string;
  modalStates: ModalState[];
  consoleMessages: ConsoleMessage[];
  downloads: { download: playwright.Download, finished: boolean, outputFile: string }[];
};

export class Tab extends EventEmitter<TabEventsInterface> {
  readonly context: Context;
  readonly page: playwright.Page;
  private _lastTitle = 'about:blank';
  private _consoleMessages: ConsoleMessage[] = [];
  private _recentConsoleMessages: ConsoleMessage[] = [];
  private _requests: Map<playwright.Request, playwright.Response | null> = new Map();
  private _onPageClose: (tab: Tab) => void;
  private _modalStates: ModalState[] = [];
  private _downloads: { download: playwright.Download, finished: boolean, outputFile: string }[] = [];

  constructor(context: Context, page: playwright.Page, onPageClose: (tab: Tab) => void) {
    super();
    this.context = context;
    this.page = page;
    this._onPageClose = onPageClose;
    page.on('console', event => this._handleConsoleMessage(messageToConsoleMessage(event)));
    page.on('pageerror', error => this._handleConsoleMessage(pageErrorToConsoleMessage(error)));
    page.on('request', request => this._requests.set(request, null));
    page.on('response', response => this._requests.set(response.request(), response));
    page.on('close', () => this._onClose());
    page.on('filechooser', chooser => {
      this.setModalState({
        type: 'fileChooser',
        description: 'File chooser',
        fileChooser: chooser,
        clearedBy: 'browser_file_upload',
      });
    });
    page.on('dialog', dialog => this._dialogShown(dialog));
    page.on('download', download => {
      void this._downloadStarted(download);
    });
    page.setDefaultNavigationTimeout(this.context.config.timeouts.navigation);
    page.setDefaultTimeout(this.context.config.timeouts.action);
    (page as any)[tabSymbol] = this;
  }

  static forPage(page: playwright.Page): Tab | undefined {
    return (page as any)[tabSymbol];
  }

  modalStates(): ModalState[] {
    return this._modalStates;
  }

  setModalState(modalState: ModalState) {
    this._modalStates.push(modalState);
    this.emit(TabEvents.modalState, modalState);
  }

  clearModalState(modalState: ModalState) {
    this._modalStates = this._modalStates.filter(state => state !== modalState);
  }

  modalStatesMarkdown(): string[] {
    return renderModalStates(this.context, this.modalStates());
  }

  private _dialogShown(dialog: playwright.Dialog) {
    this.setModalState({
      type: 'dialog',
      description: `"${dialog.type()}" dialog with message "${dialog.message()}"`,
      dialog,
      clearedBy: 'browser_handle_dialog',
    });
  }

  private async _downloadStarted(download: playwright.Download) {
    const entry = {
      download,
      finished: false,
      outputFile: await this.context.outputFile(download.suggestedFilename())
    };
    this._downloads.push(entry);
    await download.saveAs(entry.outputFile);
    entry.finished = true;
  }

  private _clearCollectedArtifacts() {
    this._consoleMessages.length = 0;
    this._recentConsoleMessages.length = 0;
    this._requests.clear();
  }

  private _handleConsoleMessage(message: ConsoleMessage) {
    this._consoleMessages.push(message);
    this._recentConsoleMessages.push(message);
  }

  private _onClose() {
    this._clearCollectedArtifacts();
    this._onPageClose(this);
  }

  async updateTitle() {
    await this._raceAgainstModalStates(async () => {
      this._lastTitle = await callOnPageNoTrace(this.page, page => page.title());
    });
  }

  lastTitle(): string {
    return this._lastTitle;
  }

  isCurrentTab(): boolean {
    return this === this.context.currentTab();
  }

  async waitForLoadState(state: 'load', options?: { timeout?: number }): Promise<void> {
    await callOnPageNoTrace(this.page, page => page.waitForLoadState(state, options).catch(logUnhandledError));
  }

  async navigate(url: string) {
    this._clearCollectedArtifacts();

    const downloadEvent = callOnPageNoTrace(this.page, page => page.waitForEvent('download').catch(logUnhandledError));
    try {
      await this.page.goto(url, { waitUntil: 'domcontentloaded' });
    } catch (_e: unknown) {
      const e = _e as Error;
      const mightBeDownload =
        e.message.includes('net::ERR_ABORTED') // chromium
        || e.message.includes('Download is starting'); // firefox + webkit
      if (!mightBeDownload)
        throw e;
      // on chromium, the download event is fired *after* page.goto rejects, so we wait a lil bit
      const download = await Promise.race([
        downloadEvent,
        new Promise(resolve => setTimeout(resolve, 3000)),
      ]);
      if (!download)
        throw e;
      // Make sure other "download" listeners are notified first.
      await new Promise(resolve => setTimeout(resolve, 500));
      return;
    }

    // Cap load event to 5 seconds, the page is operational at this point.
    await this.waitForLoadState('load', { timeout: 5000 });
  }

  consoleMessages(): ConsoleMessage[] {
    return this._consoleMessages;
  }

  requests(): Map<playwright.Request, playwright.Response | null> {
    return this._requests;
  }

  async captureSnapshot(): Promise<TabSnapshot> {
    let tabSnapshot: TabSnapshot | undefined;
    const modalStates = await this._raceAgainstModalStates(async () => {
      const snapshot = await (this.page as PageEx)._snapshotForAI();
      tabSnapshot = {
        url: this.page.url(),
        title: await this.page.title(),
        ariaSnapshot: snapshot,
        modalStates: [],
        consoleMessages: [],
        downloads: this._downloads,
      };
    });
    if (tabSnapshot) {
      // Assign console message late so that we did not lose any to modal state.
      tabSnapshot.consoleMessages = this._recentConsoleMessages;
      this._recentConsoleMessages = [];
    }
    return tabSnapshot ?? {
      url: this.page.url(),
      title: '',
      ariaSnapshot: '',
      modalStates,
      consoleMessages: [],
      downloads: [],
    };
  }

  private _javaScriptBlocked(): boolean {
    return this._modalStates.some(state => state.type === 'dialog');
  }

  private async _raceAgainstModalStates(action: () => Promise<void>): Promise<ModalState[]> {
    if (this.modalStates().length)
      return this.modalStates();

    const promise = new ManualPromise<ModalState[]>();
    const listener = (modalState: ModalState) => promise.resolve([modalState]);
    this.once(TabEvents.modalState, listener);

    return await Promise.race([
      action().then(() => {
        this.off(TabEvents.modalState, listener);
        return [];
      }),
      promise,
    ]);
  }

  async waitForCompletion(callback: () => Promise<void>) {
    await this._raceAgainstModalStates(() => waitForCompletion(this, callback));
  }

  async refLocator(params: {
    element: string,
    ref: string,
  }): Promise<playwright.Locator> {
    // Check if ref contains code information
    if (params.ref && params.ref.startsWith('###code')) {
      const codeMatch = params.ref.match(/###code(.+)/);
      if (codeMatch) {
        const code = codeMatch[1].trim();
        // Check if it's a Playwright command (starts with getBy or locator)
        if (code.startsWith('getBy') || code.startsWith('locator')) {
          try {
              const getLocator = new Function('page', `return page.${code}`);
              const locator = getLocator(this.page);   
            //const locator = this.parsePlaywrightCommand(code);
              return locator.describe(params.element);
          } catch (error) {
            throw new Error(`Failed to execute Playwright command "${code}": ${error instanceof Error ? error.message : String(error)}`);
          }
        } else {
          throw new Error(`unknown Playwright command: ${code}`);
        }
      }
    }
    // If ref provided, get locator using ref
    return  (await this.refLocators([{ element: params.element, ref: params.ref }]))[0];
  }

  private parsePlaywrightCommand(code: string): playwright.Locator {
    // Parse getBy commands safely without eval (including method chains)
    const getByMatch = code.match(/^getBy(\w+)\((.+)\)/);
    if (getByMatch) {
      const [, method, argsString] = getByMatch;
      const methodName = `getBy${method}`;

      // Check if method exists on page
      if (typeof (this.page as any)[methodName] !== 'function') {
        throw new Error(`Unknown Playwright method: ${methodName}`);
      }

      try {
        // Check if this is a method chain (contains dots after the first getBy call)
        const methodChainMatch = code.match(/^getBy(\w+)\((.+?)\)(.+)$/);
        if (methodChainMatch) {
          const [, methodName, selector, methodChain] = methodChainMatch;
          const fullMethodName = `getBy${methodName}`;
          
          // Debug logging
          // console.log(`Parsing getBy method chain: ${code}`);
          // console.log(`Method: ${fullMethodName}`);
          // console.log(`Selector: "${selector}"`);
          // console.log(`Method chain: "${methodChain}"`);

          // Parse the selector argument
          const parsedArgs = parseArguments(selector);
          
          // Start with the base getBy method
          const methodFunc = (this.page as any)[fullMethodName] as Function;
          let locator = methodFunc.apply(this.page, parsedArgs);
          
          // Parse and apply method chain
          const methods = parseMethodChain(methodChain);
          for (const method of methods) {
            locator = applyLocatorMethod(locator, method);
          }
          
          return locator;
        } else {
          // Simple getBy without method chain
          const parsedArgs = parseArguments(argsString);
          
          // Debug logging
          //console.log(`Parsing simple getBy command: ${code}`);
          //console.log(`Args string: "${argsString}"`);
          //console.log(`Parsed args:`, parsedArgs);

          // Call the method with parsed arguments
          const methodFunc = (this.page as any)[methodName] as Function;
          return methodFunc.apply(this.page, parsedArgs);
        }
      } catch (parseError) {
        console.error(`Parse error for getBy command: ${code}`);
        console.error(`Parse error details:`, parseError);
        throw new Error(`Failed to parse getBy command: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
      }
    }

    // Parse locator commands (including method chains)
    const locatorMatch = code.match(/^locator\((.+)\)/);
    if (locatorMatch) {
      const [, argsString] = locatorMatch;
      
      try {
        // Check if this is a method chain (contains dots after the first locator call)
        const methodChainMatch = code.match(/^locator\((.+?)\)(.+)$/);
        if (methodChainMatch) {
          const [, selector, methodChain] = methodChainMatch;
          
          // Debug logging
          console.log(`Parsing locator method chain: ${code}`);
          console.log(`Selector: "${selector}"`);
          console.log(`Method chain: "${methodChain}"`);

          // Parse the selector argument
          const parsedArgs = parseArguments(selector);
          if (parsedArgs.length === 0) {
            throw new Error('locator requires at least one argument (selector)');
          }

          const selectorValue = parsedArgs[0];
          if (typeof selectorValue !== 'string') {
            throw new Error('locator first argument must be a string selector');
          }

          // Start with the base locator
          let locator = this.page.locator(selectorValue);
          
          // Parse and apply method chain
          const methods = parseMethodChain(methodChain);
          for (const method of methods) {
            locator = applyLocatorMethod(locator, method);
          }
          
          return locator;
        } else {
          // Simple locator without method chain
          const parsedArgs = parseArguments(argsString);
          
          // Debug logging
          //console.log(`Parsing simple locator command: ${code}`);
          //console.log(`Args string: "${argsString}"`);
          //console.log(`Parsed args:`, parsedArgs);

          // locator takes a selector string as first argument
          if (parsedArgs.length === 0) {
            throw new Error('locator requires at least one argument (selector)');
          }

          const selector = parsedArgs[0];
          if (typeof selector !== 'string') {
            throw new Error('locator first argument must be a string selector');
          }

          return this.page.locator(selector);
        }
      } catch (parseError) {
        console.error(`Parse error for locator command: ${code}`);
        console.error(`Parse error details:`, parseError);
        throw new Error(`Failed to parse locator command: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
      }
    }

    throw new Error(`Invalid Playwright command format: ${code}. Expected getBy*() or locator() format.`);
  }

  async refLocators(params: { element: string, ref: string }[]): Promise<playwright.Locator[]> {
    const snapshot = await (this.page as PageEx)._snapshotForAI();
    return params.map(param => {
      if (!snapshot.includes(`[ref=${param.ref}]`))
        throw new Error(`Ref ${param.ref} not found in the current page snapshot. Try capturing new snapshot.`);
      return this.page.locator(`aria-ref=${param.ref}`).describe(param.element);
    });
  }

  async waitForTimeout(time: number) {
    if (this._javaScriptBlocked()) {
      await new Promise(f => setTimeout(f, time));
      return;
    }

    await callOnPageNoTrace(this.page, page => {
      return page.evaluate(() => new Promise(f => setTimeout(f, 1000)));
    });
  }
}

export type ConsoleMessage = {
  type: ReturnType<playwright.ConsoleMessage['type']> | undefined;
  text: string;
  toString(): string;
};

function messageToConsoleMessage(message: playwright.ConsoleMessage): ConsoleMessage {
  return {
    type: message.type(),
    text: message.text(),
    toString: () => `[${message.type().toUpperCase()}] ${message.text()} @ ${message.location().url}:${message.location().lineNumber}`,
  };
}

function pageErrorToConsoleMessage(errorOrValue: Error | any): ConsoleMessage {
  if (errorOrValue instanceof Error) {
    return {
      type: undefined,
      text: errorOrValue.message,
      toString: () => errorOrValue.stack || errorOrValue.message,
    };
  }
  return {
    type: undefined,
    text: String(errorOrValue),
    toString: () => String(errorOrValue),
  };
}

export function renderModalStates(context: Context, modalStates: ModalState[]): string[] {
  const result: string[] = ['### Modal state'];
  if (modalStates.length === 0)
    result.push('- There is no modal state present');
  for (const state of modalStates)
    result.push(`- [${state.description}]: can be handled by the "${state.clearedBy}" tool`);
  return result;
}

const tabSymbol = Symbol('tabSymbol');
