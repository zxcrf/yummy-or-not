module.exports = function (api) {
  api.cache(true)
  const isTest = process.env.NODE_ENV === 'test'
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // Tamagui compiler/runtime plugin — skip in Jest (NODE_ENV=test) because
      // it injects @tamagui/core runtime calls that can't be resolved from
      // the CJS stub used by unit tests.
      !isTest && [
        '@tamagui/babel-plugin',
        {
          components: ['tamagui'],
          config: './tamagui.config.ts',
          logTimings: true,
          disableExtraction: process.env.NODE_ENV === 'development',
        },
      ],
      // react-native-reanimated plugin must be listed last.
      'react-native-worklets/plugin',
    ].filter(Boolean),
  }
}
