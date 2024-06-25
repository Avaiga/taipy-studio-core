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

//@ts-check
"use strict";

const path = require("path");
const copyPlugin = require("copy-webpack-plugin");

/**@type {import('webpack').Configuration}*/
// @ts-ignore
const config = (env, argv) => ({
  target: "node", // vscode extensions run in a Node.js-context 📖 -> https://webpack.js.org/configuration/node/

  entry: "./src/taipy.ts", // the entry point of this extension, 📖 -> https://webpack.js.org/configuration/entry-context/
  output: {
    // https://webpack.js.org/configuration/output/
    path: path.resolve(__dirname, "dist"),
    filename: "taipy-studio.js",
    libraryTarget: "commonjs2",
    devtoolModuleFilenameTemplate: "../[resource-path]",
  },
  devtool: argv.mode === "development" && "source-map",
  externals: {
    vscode: "commonjs vscode", // the vscode-module is created on-the-fly and must be excluded. Add other modules that cannot be webpack'ed, 📖 -> https://webpack.js.org/configuration/externals/
  },
  resolve: {
    // support reading TypeScript and JavaScript files, 📖 -> https://github.com/TypeStrong/ts-loader
    //mainFields: ['browser', 'module', 'main'], // look for `browser` entry point in imported node modules
    extensions: [".ts", ".js"],
  },
  plugins: [
    new copyPlugin({
      patterns: [
        {
          from: path.resolve(__dirname, "node_modules/@vscode/codicons/dist"),
          to: "@vscode/codicons/dist",
        },
        {
          from: path.resolve(__dirname, "css"),
          to: "webviews",
        },
        {
          from: path.resolve(__dirname, "schemas"),
          to: "schemas"
        },
        {
          from: path.resolve(__dirname, "python"),
          to: "python"
        },
        {
          from: path.resolve(__dirname, "l10n"),
          to: "l10n",
        }
      ],
    }),
  ],
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: "ts-loader",
          },
        ],
      },
    ],
  },
});
module.exports = config;
