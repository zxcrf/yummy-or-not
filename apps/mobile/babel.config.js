module.exports = function (api) {
  api.cache(true)
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // Tamagui compiler/runtime plugin. Reads tokens/themes from tamagui.config.ts.
      [
        '@tamagui/babel-plugin',
        {
          components: ['tamagui'],
          config: './tamagui.config.ts',
          logTimings: true,
          // Runtime-only: skip CSS extraction so no tamagui.generated.css import
          // is required for the app to boot. Enable later for optimized web CSS.
          disableExtraction: process.env.NODE_ENV === 'development',
        },
      ],
      // react-native-reanimated plugin must be listed last.
      'react-native-worklets/plugin',
    ],
  }
}
