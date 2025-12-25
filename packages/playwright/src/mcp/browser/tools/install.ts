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

import { fork } from 'child_process';
import path from 'path';

import { z } from '../../sdk/bundle';
import { defineTool } from './tool';

const install = defineTool({
  capability: 'core-install',
  schema: {
    name: 'browser_install',
    title: 'Install the browser specified in the config',
    description: 'Install the browser specified in the config. Call this if you get an error about the browser not being installed.',
    inputSchema: z.object({}),
    type: 'action',
  },

  handle: async (context, params, response) => {
    const channel = context.config.browser?.launchOptions?.channel ?? context.config.browser?.browserName ?? 'chrome';

    // Log intended path from Environment Variables
    const targetPath = process.env.PLAYWRIGHT_BROWSERS_PATH || 'Default OS Cache';
    console.log(`[INFO] Attempting to install "${channel}" into: ${targetPath}`);

    const cliPath = path.join(require.resolve('@zealous-tech/playwright/package.json'), '../cli.js');

    // Use DEBUG=pw:install to get verbose installation logs from Playwright
    const child = fork(cliPath, ['install', channel], {
      stdio: 'pipe',
      env: {
        ...process.env,
        DEBUG: 'pw:install' // This tells Playwright to log exactly where it's putting things
      }
    });

    const output: string[] = [];
    child.stdout?.on('data', data => {
      console.log(`[STDOUT]: ${data}`);
      output.push(data.toString());
    });

    child.stderr?.on('data', data => {
      console.error(`[STDERR]: ${data}`); // Playwright usually logs installation paths to stderr
      output.push(data.toString());
    });

    await new Promise<void>((resolve, reject) => {
      child.on('close', code => {
        if (code === 0) {
          console.log(`[SUCCESS] Browser installed. Verified Path: ${targetPath}`);
          resolve();
        } else {
          reject(new Error(`Failed to install browser: ${output.join('')}`));
        }
      });
    });

    response.setIncludeTabs();
  },
});

export default [
  install,
];
