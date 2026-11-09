const path = require("path");
const fs = require("fs");
const { execSync } = require("child_process");
const webpack = require("webpack");
const CopyPlugin = require("copy-webpack-plugin");
const WasmPackPlugin = require("@wasm-tool/wasm-pack-plugin");
const HtmlMinimizerPlugin = require("html-minimizer-webpack-plugin");

const dist = path.resolve(__dirname, "dist");

const crypto = require("crypto");
const crypto_orig_createHash = crypto.createHash;
crypto.createHash = algorithm => crypto_orig_createHash(algorithm == "md4" ? "sha256" : algorithm);

// Identifies the build so peers on different builds refuse to play together (ADR 12):
// the commit hash, or a hash of the sources when the repository is unavailable.
function buildVersion() {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    const hash = crypto.createHash("sha256");
    for (const dir of ["js", "src"]) {
      for (const f of fs.readdirSync(path.resolve(__dirname, dir), { recursive: true }).sort()) {
        const file = path.resolve(__dirname, dir, f);
        if (fs.statSync(file).isFile()) hash.update(fs.readFileSync(file));
      }
    }
    return hash.digest("hex").slice(0, 7);
  }
}

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
    new webpack.DefinePlugin({ __BUILD_VERSION__: JSON.stringify(buildVersion()) }),

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
  },
  optimization: {
    minimizer: [
      `...`,
      new HtmlMinimizerPlugin(),
    ],
  }
};
