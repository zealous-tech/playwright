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
import { scrollSchema, DEFAULT_SCROLL_AMOUNT } from '../helpers/schemas';

declare const document: any;
declare const window: any;

function performScroll(elementOrArgs: any, locatorArgs?: any): void {
  const isPageContext = locatorArgs === undefined;
  const args = isPageContext ? elementOrArgs : locatorArgs;
  const element = isPageContext ? null : elementOrArgs;
  const { amount, direction, unit } = args;

  const DEFAULT_COLUMN_SCROLL = 150;
  const DEFAULT_ROW_SCROLL = 50;

  function findScrollTarget(el: any, direction: string): any {
    let target = el;
    let fallbackTarget = null;
    while (target && target !== document.body && target !== document.documentElement) {
      const style = window.getComputedStyle(target);
      const canScrollX = /(auto|scroll)/.test(style.overflow + style.overflowX) && target.scrollWidth > target.clientWidth;
      const canScrollY = /(auto|scroll)/.test(style.overflow + style.overflowY) && target.scrollHeight > target.clientHeight;
      const isX = direction === 'left' || direction === 'right';
      const isY = direction === 'up' || direction === 'down';
      if ((isX && canScrollX) || (isY && canScrollY)) {
        break;
      }
      if (!fallbackTarget) {
        const fallbackX = style.overflowX !== 'visible' && target.scrollWidth > target.clientWidth;
        const fallbackY = style.overflowY !== 'visible' && target.scrollHeight > target.clientHeight;
        if ((isX && fallbackX) || (isY && fallbackY)) {
          fallbackTarget = target;
        }
      }
      target = target.parentElement;
    }
    if (!target || target === document.body || target === document.documentElement) {
      if (fallbackTarget) target = fallbackTarget;
    }
    return target;
  }

  function calculateScrollAmount(target: any, amount: number, direction: string, unit: string): number {
    let calculatedAmount = amount;
    if ((unit === 'columns' || unit === 'rows') && target && target !== document.body && target !== document.documentElement) {
       let track = target;
       if (target.children.length === 1 && target.children[0].scrollWidth >= target.scrollWidth && target.children[0].scrollHeight >= target.scrollHeight) {
          track = target.children[0];
       }
       
       let items: any[] = [];
       if (unit === 'columns') {
          const firstRow = track.querySelector(':scope > tr, :scope > tbody > tr, :scope > table > tbody > tr, :scope > [role="row"], :scope > * > [role="row"]');
          if (firstRow) {
             items = Array.from(firstRow.querySelectorAll(':scope > th, :scope > td, :scope > [role="gridcell"], :scope > .cell'));
          } else {
             items = Array.from(track.querySelectorAll(':scope > li, :scope > .item, :scope > .cell, :scope > .card'));
             if (items.length === 0) items = Array.from(track.children);
          }
       } else {
          items = Array.from(track.querySelectorAll(':scope > tr, :scope > tbody > tr, :scope > table > tbody > tr, :scope > li, :scope > .item, :scope > .row, :scope > .card, :scope > [role="row"], :scope > * > [role="row"]'));
          if (items.length === 0) items = Array.from(track.children);
       }
       
       const targetRect = target.getBoundingClientRect();
       const isCol = unit === 'columns';
       const visibleItems = items.filter((c: any) => {
          const r = c.getBoundingClientRect();
          if (isCol) return r.right > targetRect.left && r.left < targetRect.right && r.width > 0;
          else return r.bottom > targetRect.top && r.top < targetRect.bottom && r.height > 0;
       });
       
       if (visibleItems.length > 0) {
          calculatedAmount = 0;
          const firstVisIndex = items.indexOf(visibleItems[0]);
          
          if (direction === 'right' || direction === 'down') {
             for (let i = 0; i < amount && (firstVisIndex + i) < items.length; i++) {
                calculatedAmount += isCol ? items[firstVisIndex + i].getBoundingClientRect().width : items[firstVisIndex + i].getBoundingClientRect().height;
             }
          } else {
             for (let i = 1; i <= amount && (firstVisIndex - i) >= 0; i++) {
                calculatedAmount += isCol ? items[firstVisIndex - i].getBoundingClientRect().width : items[firstVisIndex - i].getBoundingClientRect().height;
             }
          }
          
          if (calculatedAmount === 0) calculatedAmount = (isCol ? DEFAULT_COLUMN_SCROLL : DEFAULT_ROW_SCROLL) * amount;
       } else {
          calculatedAmount = (isCol ? DEFAULT_COLUMN_SCROLL : DEFAULT_ROW_SCROLL) * amount;
       }
    }
    return calculatedAmount;
  }

  function executeScroll(target: any, direction: string, unit: string, calculatedAmount: number): void {
    let dx = 0;
    let dy = 0;
    if (unit === 'max') {
      const h = target && target !== document.body && target !== document.documentElement ? target.scrollHeight : document.documentElement.scrollHeight;
      const w = target && target !== document.body && target !== document.documentElement ? target.scrollWidth : document.documentElement.scrollWidth;
      dy = direction === 'up' ? -h : direction === 'down' ? h : 0;
      dx = direction === 'left' ? -w : direction === 'right' ? w : 0;
    } else {
      dx = direction === 'left' ? -calculatedAmount : direction === 'right' ? calculatedAmount : 0;
      dy = direction === 'up' ? -calculatedAmount : direction === 'down' ? calculatedAmount : 0;
    }
  
    if (target && target !== document.body && target !== document.documentElement) {
      target.scrollBy({ top: dy, left: dx, behavior: 'auto' });
    } else {
      window.scrollBy({ top: dy, left: dx, behavior: 'auto' });
    }
  }

  if (element) {
    const target = findScrollTarget(element, direction);
    const calculatedAmount = calculateScrollAmount(target, amount, direction, unit);
    executeScroll(target, direction, unit, calculatedAmount);
  } else {
    const calcAmt = direction === 'left' || direction === 'right' ? (amount * DEFAULT_COLUMN_SCROLL) : (amount * DEFAULT_ROW_SCROLL);
    executeScroll(null, direction, unit, calcAmt);
  }
}

export const browser_scroll = defineTabTool({
  capability: 'core',
  schema: {
    name: 'browser_scroll',
    title: 'Scroll',
    description: 'Scroll the page viewport or a specific scrollable element (e.g., div, table, list, modal, or any scrollable area) either by a specific amount/direction or to a target element.',
    inputSchema: scrollSchema,
    type: 'input',
  },

  handle: async (tab, params, response) => {
    response.setIncludeSnapshot();

    if (params.targetElement) {
      const { locator: targetLoc, resolved: targetResolved } = await tab.refLocator(params.targetElement);
      response.addCode(`await page.${targetResolved}.scrollIntoViewIfNeeded();`);

      await tab.waitForCompletion(async () => {
        await targetLoc.scrollIntoViewIfNeeded();
      });
      
      const elName = params.targetElement.element || params.targetElement.ref;
      if (params.currentElement) {
        const containerName = params.currentElement.element || params.currentElement.ref;
        response.addTextResult(`Scrolled container "${containerName}" to target element "${elName}"`);
      } else {
        response.addTextResult(`Scrolled to target element "${elName}"`);
      }
    } else {
      const amount = params.amount ?? DEFAULT_SCROLL_AMOUNT;
      const unit = params.unit ?? 'pixels';
      const direction = params.direction || 'down';

      if (params.currentElement) {
        const { locator: containerLoc, resolved: containerResolved } = await tab.refLocator(params.currentElement);
        response.addCode(`// Scroll using internal helper\nawait page.${containerResolved}.evaluate(performScroll, { amount: ${amount}, direction: '${direction}', unit: '${unit}' });`);

        await tab.waitForCompletion(async () => {
          await containerLoc.evaluate(performScroll, { amount, direction, unit });
        });

        const containerName = params.currentElement.element || params.currentElement.ref;
        response.addTextResult(`Scrolled container "${containerName}" by ${amount} pixels ${params.direction}`);
      } else {
        response.addCode(`// Scroll using internal helper\nawait page.evaluate(performScroll, { amount: ${amount}, direction: '${direction}', unit: '${unit}' });`);

        await tab.waitForCompletion(async () => {
          await tab.page.evaluate(performScroll, { amount, direction, unit });
        });

        response.addTextResult(`Scrolled page viewport by ${amount} pixels ${params.direction || 'down'}`);
      }
    }

    await tab.page.waitForLoadState('load');
  },
});
