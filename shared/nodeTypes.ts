/*
 * Copyright 2024 Avaiga Private Limited
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 *
 *        http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on
 * an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the
 * specific language governing permissions and limitations under the License.
 */
import { DataNode, Scenario, Task, PROP_INPUTS, PROP_OUTPUTS, PROP_TASKS, PROP_DATANODES, Sequence } from "./names";

type Descendant = Record<string, string> | undefined;
const _descendantProperties: Record<string, [Descendant, Descendant]> = {
  [Scenario]: [undefined, { [PROP_TASKS]: Task, [PROP_DATANODES]: DataNode }],
  [Task]: [{ [PROP_INPUTS]: DataNode }, { [PROP_OUTPUTS]: DataNode }],
  [Sequence]: [undefined, {[PROP_TASKS]: Task}]
};
export const getDescendantProperties = (nodeType: string) => _descendantProperties[nodeType] || [undefined, undefined];

const _childTypes: Record<string, Set<string>> = {};
export const getChildTypes = (nodeType: string) => {
  if (!_childTypes[nodeType]) {
    _childTypes[nodeType] = new Set(
      getDescendantProperties(nodeType)
        .filter((d) => d)
        .map((desc) => Object.values(desc as Record<string, string>))
        .flat()
        .filter((p) => p)
    );
  }
  return _childTypes[nodeType];
};
