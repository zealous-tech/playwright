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
import { dynamicSwitchSchema } from '../helpers/schemas';

export const dynamic_switch = defineTabTool({
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
    if (matchedIndex === -1 && defaultCase)
      chosenTool = { toolName: defaultCase.toolName, params: defaultCase.params, readyForCaching: defaultCase.readyForCaching };


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

    response.addTextResult(JSON.stringify(payload, null, 2));
  },
});
