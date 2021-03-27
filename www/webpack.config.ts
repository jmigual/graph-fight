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
  plugins: [
    new CopyPlugin(['index.html'])
  ]
}

export default config;