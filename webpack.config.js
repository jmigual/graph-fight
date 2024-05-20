const path = require("path");
const CopyPlugin = require("copy-webpack-plugin");
const WasmPackPlugin = require("@wasm-tool/wasm-pack-plugin");

const dist = path.resolve(__dirname, "dist");

const crypto = require("crypto");
const { experiments } = require("webpack");
const crypto_orig_createHash = crypto.createHash;
crypto.createHash = algorithm => crypto_orig_createHash(algorithm == "md4" ? "sha256" : algorithm);

module.exports = {
  mode: "production",
  entry: {
    index: "./js/index.ts"
  },
  output: {
    path: dist,
    filename: "[name].js"
  },
  devServer: {
    static: dist,
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      }
    ]
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.js', '.wasm']
  },
  plugins: [
    new CopyPlugin({
      patterns: [
        { from: "static", to: dist }
      ]
    }),

    new WasmPackPlugin({
      crateDirectory: __dirname,
    }),
  ],
  experiments: {
    asyncWebAssembly: true,
  }
};
