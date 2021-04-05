import * as CopyPlugin from 'copy-webpack-plugin';
import * as path from 'path';
import * as webpack from 'webpack';

import 'webpack-dev-server';


const config: webpack.Configuration = {
  mode: 'development',
  entry: './src/client/bootstrap.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'bootstrap.js',
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
    new CopyPlugin(['index.html'])
  ]
}

export default config;