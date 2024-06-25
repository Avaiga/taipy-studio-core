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

"use strict";
const Parser = require("@iarna/toml/lib/parser.js");

const _pos = Symbol("pos");

const improveState = (parser, state, line, col) => {
  state.line = line;
  state.col = col;
  Object.defineProperty(state, "resultTable", {
    set: (val) => {
      if (val && typeof val == "object") {
        Object.defineProperty(val, _pos, { value: [{ line: line, col: col }] });
      }
      state._resultTable = val;
    },
    get: () => {
      return state._resultTable;
    },
  });
  Object.defineProperty(state, "resultArr", {
    set: (val) => {
      if (Array.isArray(val)) {
        Object.defineProperty(val, _pos, { value: [{ line: line, col: col }] });
        val._push = val.push
        val.push = (...args) => {
          val[_pos].push({line: parser.line, col: parser.col - (typeof args[0] == "string" ? (args[0].length + 1) : 0)});
          return val._push(...args);
        }
      }
      state._resultArr = val;
    },
    get: () => {
      return state._resultArr;
    },
  });
};

const addCodePos = (obj, line, col) => obj && Array.isArray(obj[_pos]) && obj[_pos].push({ line, col });

class PosParser extends Parser {
  constructor(...args) {
    super(...args);
    improveState(this, this.state, 0, 0);
    Object.defineProperty(this, "ctx", {
      set: (val) => {
        if (val && typeof val == "object" && !val[_pos]) {
          Object.defineProperty(val, _pos, { value: [{ line: this.state.line, col: this.state.col + 1 }] });
        }
        addCodePos(this._ctx, this.line, this.col < 1 ? 0 : this.col -1);
        this._ctx = val;
      },
      get: () => {
        return this._ctx;
      },
    });
  }
  call(fn, ...args) {
    super.call(fn, ...args);
    improveState(this, this.state, this.line, this.col);
  }
  return(val) {
    if (val && typeof val == "object") {
      Array.isArray(val[_pos]) ? val[_pos].push({ line: this.line, col: this.col }) :  Object.defineProperty(val, _pos, { value: [{ line: this.state.line, col: this.state.col }] });
    }
    return super.return(val);
  }
  finish () {
    addCodePos(this.obj, this.line, this.col < 1 ? 0 : this.col -1);
    return super.finish()
  }
}
PosParser.PosSymbol = _pos;
module.exports = PosParser;
