const path = require('path');

module.exports = {
    mode: 'production', // Fixes the 'mode' warning
    entry: './NATOCR.js', // Tells Webpack your main file is here, not in ./src
    devtool: 'inline-source-map', // Helps with debugging
    resolve: {
        extensions: ['.tsx', '.ts', '.js'],
    },
    output: {
        filename: 'main.js', // The output file name
        path: path.resolve(__dirname, 'dist'), // The output folder
    },
};